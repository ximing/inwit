import type {
  Annotation,
  CanvasMember,
  CanvasNode,
  CreateCanvasNodeInput,
  CreateCanvasNoteInput,
  SetCanvasNodeInput,
} from '@inwit/dto';
import { mergeCanvasForest, planOutlineDetach, planOutlineMove, planOutlinePlace } from '@inwit/dto';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { assertOwnedAssetKey } from '../assets/asset-logic.js';
import { getDb, type Database } from '../db/index.js';
import {
  annotations,
  canvasNodes,
  cards,
  type AnnotationRow,
  type CanvasNodeRow,
} from '../db/schema.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
import { tryIndexAnnotation } from '../retrieval/pipeline.js';
import { isAnnotationImageKeyFor } from '../annotations/annotation-image-logic.js';
import { commitCanvasRevision, readCanvasHistoryState } from './canvas-history.js';
import {
  planMindEdits,
  type MindEditInput,
  type MindEditParent,
  type MindTreeNode,
} from './mind-edit-logic.js';

type CanvasDb = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

function toPublic(row: CanvasNodeRow): CanvasNode {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    cardId: row.cardId,
    annotationId: row.annotationId,
    text: row.text,
    imageKey: row.imageKey,
    parentId: row.parentId,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function virtualNode(documentId: string, member: CanvasMember): CanvasNode {
  const now = new Date().toISOString();
  return {
    id: member.id,
    documentId,
    kind: member.kind,
    cardId: member.kind === 'card' ? member.id : null,
    annotationId: member.kind === 'annotation' ? member.id : null,
    text: null,
    imageKey: null,
    parentId: member.parentId,
    position: member.position,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadVisible(
  db: CanvasDb,
  userId: string,
  documentId: string,
): Promise<{ forest: CanvasMember[]; rows: CanvasNodeRow[] }> {
  const cardRows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, documentId),
        isNull(cards.deletedAt),
        ne(cards.acceptance, 'rejected'),
      ),
    );
  const noteRows = await db
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        eq(annotations.documentId, documentId),
        isNull(annotations.deletedAt),
      ),
    );
  const rows = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.userId, userId), eq(canvasNodes.documentId, documentId)))
    .orderBy(asc(canvasNodes.createdAt), asc(canvasNodes.id));
  const forest = mergeCanvasForest(
    cardRows.map((row) => row.id),
    noteRows.map((row) => row.id),
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      cardId: row.cardId,
      annotationId: row.annotationId,
      parentId: row.parentId,
      position: row.position,
    })),
  );
  return { forest, rows };
}

async function ensureMemberRow(
  db: CanvasDb,
  userId: string,
  documentId: string,
  memberId: string,
  loaded: { forest: CanvasMember[]; rows: CanvasNodeRow[] },
): Promise<void> {
  if (loaded.rows.some((row) => row.id === memberId)) return;
  const member = loaded.forest.find((item) => item.id === memberId);
  if (!member || (member.kind !== 'card' && member.kind !== 'annotation')) {
    throw AppError.of(404, 'NOT_FOUND');
  }
  await db.insert(canvasNodes).values({
    id: memberId,
    userId,
    documentId,
    kind: member.kind,
    cardId: member.kind === 'card' ? memberId : null,
    annotationId: member.kind === 'annotation' ? memberId : null,
    parentId: null,
    position: 0,
  });
  loaded.rows.push({
    id: memberId,
    userId,
    documentId,
    kind: member.kind,
    cardId: member.kind === 'card' ? memberId : null,
    annotationId: member.kind === 'annotation' ? memberId : null,
    text: null,
    imageKey: null,
    parentId: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function mirrorCardOutline(
  db: CanvasDb,
  userId: string,
  forest: CanvasMember[],
  cardId: string,
  parentId: string | null,
  position: number,
  now: Date,
): Promise<void> {
  const parent = parentId ? forest.find((member) => member.id === parentId) : null;
  await db
    .update(cards)
    .set({
      outlineParentId: parent?.kind === 'card' ? parent.id : null,
      outlinePosition: position,
      updatedAt: now,
    })
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
}

async function writeMove(
  db: CanvasDb,
  userId: string,
  documentId: string,
  loaded: { forest: CanvasMember[]; rows: CanvasNodeRow[] },
  move: { id: string; parentId: string | null; position: number },
  now: Date,
): Promise<CanvasNodeRow> {
  if (move.parentId) await ensureMemberRow(db, userId, documentId, move.parentId, loaded);
  await ensureMemberRow(db, userId, documentId, move.id, loaded);
  const [updated] = await db
    .update(canvasNodes)
    .set({ parentId: move.parentId, position: move.position, updatedAt: now })
    .where(
      and(
        eq(canvasNodes.id, move.id),
        eq(canvasNodes.userId, userId),
        eq(canvasNodes.documentId, documentId),
      ),
    )
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
  const member = loaded.forest.find((item) => item.id === move.id);
  if (member?.kind === 'card') {
    await mirrorCardOutline(db, userId, loaded.forest, move.id, move.parentId, move.position, now);
  }
  return updated;
}

async function placeInTx(
  db: CanvasDb,
  userId: string,
  documentId: string,
  nodeId: string,
  parentId: string | null,
  index?: number,
): Promise<CanvasNode> {
  const loaded = await loadVisible(db, userId, documentId);
  const member = loaded.forest.find((item) => item.id === nodeId);
  if (!member) throw AppError.of(404, 'NOT_FOUND');
  const existing = () => {
    const row = loaded.rows.find((item) => item.id === nodeId);
    return row ? toPublic(row) : virtualNode(documentId, member);
  };
  // 成员可能只有合并视图里的虚拟根（批注/卡片还没有 canvas 行）：
  // 「位置不变」的落位也要补写真实行，挂到目标父节点末尾，避免脏位置与既有行重叠。
  const persistFirstPlacement = async (): Promise<CanvasNode> => {
    let position = 0;
    for (const item of loaded.forest) {
      if (item.parentId === parentId && item.id !== nodeId && item.position >= position) {
        position = item.position + 1;
      }
    }
    const updated = await writeMove(
      db,
      userId,
      documentId,
      loaded,
      { id: nodeId, parentId, position },
      new Date(),
    );
    return toPublic(updated);
  };
  if (index === undefined) {
    const plan = planOutlineMove(loaded.forest, nodeId, parentId);
    if (!plan.ok) throw AppError.of(400, 'CANVAS_NODE_INVALID');
    if (plan.unchanged) {
      if (!loaded.rows.some((item) => item.id === nodeId)) return persistFirstPlacement();
      return existing();
    }
    const updated = await writeMove(
      db,
      userId,
      documentId,
      loaded,
      { id: nodeId, parentId: plan.parentId, position: plan.position },
      new Date(),
    );
    return toPublic(updated);
  }
  const plan = planOutlinePlace(loaded.forest, nodeId, parentId, index);
  if (!plan.ok) throw AppError.of(400, 'CANVAS_NODE_INVALID');
  if (plan.unchanged || plan.moves.length === 0) {
    if (!loaded.rows.some((item) => item.id === nodeId)) return persistFirstPlacement();
    return existing();
  }
  const now = new Date();
  let primary: CanvasNodeRow | null = null;
  for (const move of plan.moves) {
    const updated = await writeMove(db, userId, documentId, loaded, move, now);
    if (move.id === nodeId) primary = updated;
  }
  if (!primary) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublic(primary);
}

function inCanvasTransaction<T>(
  userId: string,
  documentId: string,
  run: (tx: CanvasDb) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    const before = await readCanvasHistoryState(tx, userId, documentId);
    const result = await run(tx);
    await commitCanvasRevision(tx, userId, documentId, before);
    return result;
  });
}

export async function listCanvasNodes(userId: string, documentId: string): Promise<CanvasNode[]> {
  await getOwnedDocument(userId, documentId);
  const { rows } = await loadVisible(getDb(), userId, documentId);
  return rows.map(toPublic);
}

export async function placeCanvasMember(
  userId: string,
  documentId: string,
  nodeId: string,
  parentId: string | null,
): Promise<CanvasNode> {
  await getOwnedDocument(userId, documentId);
  return inCanvasTransaction(userId, documentId, (tx) =>
    placeInTx(tx, userId, documentId, nodeId, parentId),
  );
}

export async function createCanvasNode(
  userId: string,
  documentId: string,
  input: CreateCanvasNodeInput,
): Promise<CanvasNode> {
  await getOwnedDocument(userId, documentId);
  if (input.kind === 'image') assertOwnedAssetKey(userId, input.imageKey);
  return inCanvasTransaction(userId, documentId, async (tx) => {
    const loaded = await loadVisible(tx, userId, documentId);
    let position = 0;
    if (input.parentId == null) {
      for (const member of loaded.forest) {
        if (member.parentId === null && member.position >= position) position = member.position + 1;
      }
    }
    const [row] = await tx
      .insert(canvasNodes)
      .values({
        userId,
        documentId,
        kind: input.kind,
        text: input.kind === 'text' ? input.text : null,
        imageKey: input.kind === 'image' ? input.imageKey : null,
        parentId: null,
        position,
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    if (input.parentId == null && input.index === undefined) return toPublic(row);
    return placeInTx(tx, userId, documentId, row.id, input.parentId ?? null, input.index);
  });
}

function toPublicAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    userId: row.userId,
    documentId: row.documentId,
    quote: row.quote,
    note: row.note,
    kind: row.kind,
    pageIndex: row.pageIndex ?? null,
    anchorBlockIndex: row.anchorBlockIndex ?? null,
    geometry: row.geometry ?? null,
    imageKey: row.imageKey ?? null,
    positionMs: row.positionMs ?? null,
    hasConvertedCard: row.convertedCardId != null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * 脑图上的文本/图片：新建一条想法并落位，记成同一版历史。
 * 分开写的话，拍「改动前」时想法已经在库里，恢复删不掉它。
 */
export async function createPlacedNote(
  userId: string,
  documentId: string,
  input: CreateCanvasNoteInput,
): Promise<{ annotation: Annotation; node: CanvasNode }> {
  await getOwnedDocument(userId, documentId);
  const note = input.note?.trim() ?? '';
  const imageKey = input.imageKey ?? null;
  if (!note && !imageKey) throw AppError.of(400, 'VALIDATION_ERROR');
  if (imageKey && !isAnnotationImageKeyFor(userId, documentId, imageKey)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const created = await inCanvasTransaction(userId, documentId, async (tx) => {
    const [row] = await tx
      .insert(annotations)
      .values({
        userId,
        documentId,
        quote: '',
        note,
        kind: 'note',
        imageKey,
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    const node = await placeInTx(tx, userId, documentId, row.id, input.parentId ?? null, input.index);
    return { annotation: toPublicAnnotation(row), node };
  });
  await tryIndexAnnotation({
    id: created.annotation.id,
    userId,
    documentId,
    kind: 'note',
    quote: '',
    note,
  });
  return created;
}

export async function updateCanvasNode(
  userId: string,
  documentId: string,
  nodeId: string,
  input: SetCanvasNodeInput,
): Promise<CanvasNode> {
  await getOwnedDocument(userId, documentId);
  return inCanvasTransaction(userId, documentId, async (tx) => {
    if (input.text !== undefined) {
      const [row] = await tx
        .update(canvasNodes)
        .set({ text: input.text, updatedAt: new Date() })
        .where(
          and(
            eq(canvasNodes.id, nodeId),
            eq(canvasNodes.userId, userId),
            eq(canvasNodes.documentId, documentId),
            eq(canvasNodes.kind, 'text'),
          ),
        )
        .returning();
      if (!row) throw AppError.of(400, 'VALIDATION_ERROR');
      if (input.parentId === undefined) return toPublic(row);
    }
    if (input.parentId === undefined) throw AppError.of(400, 'VALIDATION_ERROR');
    return placeInTx(tx, userId, documentId, nodeId, input.parentId, input.index);
  });
}

export async function deleteCanvasNode(
  userId: string,
  documentId: string,
  nodeId: string,
): Promise<void> {
  await getOwnedDocument(userId, documentId);
  await inCanvasTransaction(userId, documentId, async (tx) => {
    const [row] = await tx
      .select({ kind: canvasNodes.kind })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.id, nodeId),
          eq(canvasNodes.userId, userId),
          eq(canvasNodes.documentId, documentId),
        ),
      )
      .limit(1);
    if (!row) throw AppError.of(404, 'NOT_FOUND');
    if (row.kind === 'card' || row.kind === 'annotation') {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    await detachCanvasMember(tx, userId, nodeId);
    await tx
      .delete(canvasNodes)
      .where(
        and(
          eq(canvasNodes.id, nodeId),
          eq(canvasNodes.userId, userId),
          eq(canvasNodes.documentId, documentId),
        ),
      );
  });
}

/**
 * 卡片或批注离开可见树之前调用。直接子节点各自成为一棵树。
 * 这一行自己的 parent 留着，恢复后还能挂回去。
 */
export async function detachCanvasMember(
  db: CanvasDb,
  userId: string,
  memberId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: canvasNodes.id, documentId: canvasNodes.documentId })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.id, memberId), eq(canvasNodes.userId, userId)))
    .limit(1);
  if (!row) return;

  const { forest } = await loadVisible(db, userId, row.documentId);
  const plan = planOutlineDetach(forest, memberId);
  const now = new Date();
  for (const move of plan.moves) {
    await db
      .update(canvasNodes)
      .set({ parentId: move.parentId, position: move.position, updatedAt: now })
      .where(and(eq(canvasNodes.id, move.id), eq(canvasNodes.userId, userId)));
    const child = forest.find((member) => member.id === move.id);
    if (child?.kind === 'card') {
      await mirrorCardOutline(db, userId, forest, move.id, move.parentId, move.position, now);
    }
  }
}

function firstLine(value: string | null | undefined, fallback: string): string {
  const line = (value ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? fallback;
}

async function loadMindSnapshot(
  db: CanvasDb,
  userId: string,
  documentId: string,
): Promise<MindTreeNode[]> {
  const { forest, rows } = await loadVisible(db, userId, documentId);
  const cardIds = forest.filter((member) => member.kind === 'card').map((member) => member.id);
  const noteIds = forest.filter((member) => member.kind === 'annotation').map((member) => member.id);
  const cardRows =
    cardIds.length === 0
      ? []
      : await db
          .select({ id: cards.id, concept: cards.concept })
          .from(cards)
          .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds)));
  const noteRows =
    noteIds.length === 0
      ? []
      : await db
          .select({ id: annotations.id, note: annotations.note, quote: annotations.quote })
          .from(annotations)
          .where(and(eq(annotations.userId, userId), inArray(annotations.id, noteIds)));
  const conceptOf = new Map(cardRows.map((row) => [row.id, row.concept]));
  const noteOf = new Map(noteRows.map((row) => [row.id, firstLine(row.note, '') || row.quote]));
  const textOf = new Map(
    rows.filter((row) => row.kind === 'text').map((row) => [row.id, row.text ?? '']),
  );
  return forest.map((member) => {
    let label = '图片';
    if (member.kind === 'card') label = firstLine(conceptOf.get(member.id), '卡片');
    else if (member.kind === 'annotation') label = firstLine(noteOf.get(member.id), '批注');
    else if (member.kind === 'text') label = firstLine(textOf.get(member.id), '文本');
    return {
      id: member.id,
      kind: member.kind,
      parentId: member.parentId,
      position: member.position,
      label,
    };
  });
}

export async function loadDocumentMind(
  userId: string,
  documentId: string,
): Promise<{ title: string | null; nodes: MindTreeNode[] }> {
  const doc = await getOwnedDocument(userId, documentId);
  const nodes = await loadMindSnapshot(getDb(), userId, documentId);
  return { title: doc.title, nodes };
}

function resolveStoredParent(parent: MindEditParent, refs: ReadonlyMap<string, string>): string | null {
  if (parent.kind === 'root') return null;
  if (parent.kind === 'id') return parent.id;
  const id = refs.get(parent.ref);
  if (!id) throw new AppError(400, 'VALIDATION_ERROR', `还没有名为 ${parent.ref} 的章节`);
  return id;
}

export type MindEditResult =
  | {
      ok: true;
      created: Record<string, string>;
      createdCount: number;
      renamedCount: number;
      movedCount: number;
      deletedCount: number;
    }
  | { ok: false; reason: string };

/**
 * 在一个事务里按顺序改一篇文档的脑图。
 * 计划不合法时不写库。中途失败则整批回滚。
 */
export async function applyDocumentMindEdits(
  userId: string,
  documentId: string,
  edits: readonly MindEditInput[],
): Promise<MindEditResult> {
  try {
    await getOwnedDocument(userId, documentId);
    return await inCanvasTransaction(userId, documentId, async (tx) => {
      const snapshot = await loadMindSnapshot(tx, userId, documentId);
      const plan = planMindEdits(snapshot, edits);
      if (!plan.ok) return { ok: false, reason: plan.reason };

      const refs = new Map<string, string>();
      const created: Record<string, string> = {};
      for (const step of plan.steps) {
        if (step.op === 'create_text') {
          const parentId = resolveStoredParent(step.parent, refs);
          const loaded = await loadVisible(tx, userId, documentId);
          let position = 0;
          if (parentId === null) {
            for (const member of loaded.forest) {
              if (member.parentId === null && member.position >= position) position = member.position + 1;
            }
          }
          const [row] = await tx
            .insert(canvasNodes)
            .values({
              userId,
              documentId,
              kind: 'text',
              text: step.text,
              parentId: null,
              position,
            })
            .returning();
          if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
          refs.set(step.ref, row.id);
          created[step.ref] = row.id;
          if (!(parentId === null && step.index === undefined)) {
            await placeInTx(tx, userId, documentId, row.id, parentId, step.index);
          }
          continue;
        }

        if (step.op === 'rename_text') {
          const [row] = await tx
            .update(canvasNodes)
            .set({ text: step.text, updatedAt: new Date() })
            .where(
              and(
                eq(canvasNodes.id, step.nodeId),
                eq(canvasNodes.userId, userId),
                eq(canvasNodes.documentId, documentId),
                eq(canvasNodes.kind, 'text'),
              ),
            )
            .returning();
          if (!row) throw new AppError(400, 'VALIDATION_ERROR', '只能修改章节标题');
          continue;
        }

        if (step.op === 'move') {
          const parentId = resolveStoredParent(step.parent, refs);
          await placeInTx(tx, userId, documentId, step.nodeId, parentId, step.index);
          continue;
        }

        const [existing] = await tx
          .select({ kind: canvasNodes.kind })
          .from(canvasNodes)
          .where(
            and(
              eq(canvasNodes.id, step.nodeId),
              eq(canvasNodes.userId, userId),
              eq(canvasNodes.documentId, documentId),
            ),
          )
          .limit(1);
        if (!existing || existing.kind !== 'text') {
          throw new AppError(400, 'VALIDATION_ERROR', '只能删除章节文本');
        }
        await detachCanvasMember(tx, userId, step.nodeId);
        await tx
          .delete(canvasNodes)
          .where(
            and(
              eq(canvasNodes.id, step.nodeId),
              eq(canvasNodes.userId, userId),
              eq(canvasNodes.documentId, documentId),
            ),
          );
      }

      return {
        ok: true as const,
        created,
        createdCount: plan.createdCount,
        renamedCount: plan.renamedCount,
        movedCount: plan.movedCount,
        deletedCount: plan.deletedCount,
      };
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'DOCUMENT_NOT_FOUND') {
      return { ok: false, reason: '找不到这篇文档' };
    }
    if (err instanceof AppError && err.message.trim()) {
      return { ok: false, reason: err.message.trim() };
    }
    throw err;
  }
}
