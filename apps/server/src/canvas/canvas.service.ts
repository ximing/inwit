import type { CanvasMember, CanvasNode, CreateCanvasNodeInput, SetCanvasNodeInput } from '@inwit/dto';
import { mergeCanvasForest, planOutlineDetach, planOutlineMove } from '@inwit/dto';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { assertOwnedAssetKey } from '../assets/asset-logic.js';
import { getDb, type Database } from '../db/index.js';
import {
  annotations,
  canvasNodes,
  cards,
  type CanvasNodeRow,
} from '../db/schema.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';

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

async function placeInTx(
  db: CanvasDb,
  userId: string,
  documentId: string,
  nodeId: string,
  parentId: string | null,
): Promise<CanvasNode> {
  const loaded = await loadVisible(db, userId, documentId);
  const member = loaded.forest.find((item) => item.id === nodeId);
  if (!member) throw AppError.of(404, 'NOT_FOUND');
  const plan = planOutlineMove(loaded.forest, nodeId, parentId);
  if (!plan.ok) throw AppError.of(400, 'CANVAS_NODE_INVALID');
  if (plan.unchanged) {
    const row = loaded.rows.find((item) => item.id === nodeId);
    return row ? toPublic(row) : virtualNode(documentId, member);
  }
  if (plan.parentId) await ensureMemberRow(db, userId, documentId, plan.parentId, loaded);
  await ensureMemberRow(db, userId, documentId, nodeId, loaded);
  const now = new Date();
  const [updated] = await db
    .update(canvasNodes)
    .set({ parentId: plan.parentId, position: plan.position, updatedAt: now })
    .where(
      and(
        eq(canvasNodes.id, nodeId),
        eq(canvasNodes.userId, userId),
        eq(canvasNodes.documentId, documentId),
      ),
    )
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
  if (member.kind === 'card') {
    await mirrorCardOutline(db, userId, loaded.forest, nodeId, plan.parentId, plan.position, now);
  }
  return toPublic(updated);
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
  return getDb().transaction((tx) => placeInTx(tx, userId, documentId, nodeId, parentId));
}

export async function createCanvasNode(
  userId: string,
  documentId: string,
  input: CreateCanvasNodeInput,
): Promise<CanvasNode> {
  await getOwnedDocument(userId, documentId);
  if (input.kind === 'image') assertOwnedAssetKey(userId, input.imageKey);
  return getDb().transaction(async (tx) => {
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
    if (input.parentId == null) return toPublic(row);
    return placeInTx(tx, userId, documentId, row.id, input.parentId);
  });
}

export async function updateCanvasNode(
  userId: string,
  documentId: string,
  nodeId: string,
  input: SetCanvasNodeInput,
): Promise<CanvasNode> {
  await getOwnedDocument(userId, documentId);
  return getDb().transaction(async (tx) => {
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
    return placeInTx(tx, userId, documentId, nodeId, input.parentId);
  });
}

export async function deleteCanvasNode(
  userId: string,
  documentId: string,
  nodeId: string,
): Promise<void> {
  await getOwnedDocument(userId, documentId);
  await getDb().transaction(async (tx) => {
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
 * 卡片或批注离开可见树之前调用。直接子节点升到它的父节点下。
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
