import type { AnnotationKind, CanvasRevision, CanvasSnapshotNode } from '@inwit/dto';
import { canvasSnapshotSchema } from '@inwit/dto';
import { and, count, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { annotations, canvasNodes, canvasRevisions, cards } from '../db/schema.js';
import { getOwnedDocument } from '../documents/document.service.js';
import { AppError } from '../errors.js';
import { tryDeleteAnnotationFromIndex, tryIndexAnnotation } from '../retrieval/pipeline.js';
import {
  CANVAS_HISTORY_BASELINE,
  CANVAS_HISTORY_LIMIT,
  type CanvasHistoryState,
  canvasRevisionMatches,
  cardOutlinesAfterRestore,
  describeHistoryChange,
  normalizeCanvasSnapshot,
  planAnnotationRestore,
  planCanvasRestore,
  restoreCanvasSummary,
} from './canvas-history-logic.js';

type RevisionDb = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

type NoteRow = {
  id: string;
  userId: string;
  documentId: string;
  kind: AnnotationKind;
  quote: string;
  note: string;
  imageKey: string | null;
  anchorBlockIndex: number | null;
  deletedAt: Date | null;
};

function clipSummary(summary: string): string {
  const chars = Array.from(summary.trim());
  if (chars.length === 0) return '调整了脑图';
  return chars.length <= 200 ? chars.join('') : chars.slice(0, 200).join('');
}

export async function readCanvasSnapshot(
  db: RevisionDb,
  userId: string,
  documentId: string,
): Promise<CanvasSnapshotNode[]> {
  const rows = await db
    .select({
      id: canvasNodes.id,
      kind: canvasNodes.kind,
      cardId: canvasNodes.cardId,
      annotationId: canvasNodes.annotationId,
      text: canvasNodes.text,
      imageKey: canvasNodes.imageKey,
      parentId: canvasNodes.parentId,
      position: canvasNodes.position,
    })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.userId, userId), eq(canvasNodes.documentId, documentId)));
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

async function readLiveAnnotations(
  db: RevisionDb,
  userId: string,
  documentId: string,
): Promise<CanvasHistoryState['annotations']> {
  const rows = await db
    .select({
      id: annotations.id,
      note: annotations.note,
      imageKey: annotations.imageKey,
      quote: annotations.quote,
      anchorBlockIndex: annotations.anchorBlockIndex,
    })
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        eq(annotations.documentId, documentId),
        isNull(annotations.deletedAt),
      ),
    );
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.map((row) => ({
    id: row.id,
    note: row.note,
    imageKey: row.imageKey ?? null,
    quote: row.quote,
    anchorBlockIndex: row.anchorBlockIndex ?? null,
  }));
}

export async function readCanvasHistoryState(
  db: RevisionDb,
  userId: string,
  documentId: string,
): Promise<CanvasHistoryState> {
  const [nodes, notes] = await Promise.all([
    readCanvasSnapshot(db, userId, documentId),
    readLiveAnnotations(db, userId, documentId),
  ]);
  return { nodes, annotations: notes };
}

function storedSnapshot(state: CanvasHistoryState) {
  return {
    nodes: [...state.nodes],
    annotations: [...state.annotations],
  };
}

async function trimCanvasRevisions(db: RevisionDb, userId: string, documentId: string): Promise<void> {
  const keep = await db
    .select({ id: canvasRevisions.id })
    .from(canvasRevisions)
    .where(and(eq(canvasRevisions.userId, userId), eq(canvasRevisions.documentId, documentId)))
    .orderBy(desc(canvasRevisions.createdAt), desc(canvasRevisions.id))
    .limit(CANVAS_HISTORY_LIMIT);
  if (keep.length < CANVAS_HISTORY_LIMIT) return;
  await db.delete(canvasRevisions).where(
    and(
      eq(canvasRevisions.userId, userId),
      eq(canvasRevisions.documentId, documentId),
      notInArray(
        canvasRevisions.id,
        keep.map((row) => row.id),
      ),
    ),
  );
}

/** 结构或批注有变化才记一版。第一笔同时留下改动前的快照。summary 可覆盖自动摘要。 */
export async function commitCanvasRevision(
  db: RevisionDb,
  userId: string,
  documentId: string,
  before: CanvasHistoryState,
  summaryOverride?: string,
): Promise<void> {
  const after = await readCanvasHistoryState(db, userId, documentId);
  const auto = describeHistoryChange(before, after);
  if (!auto) return;
  const [row] = await db
    .select({ n: count() })
    .from(canvasRevisions)
    .where(and(eq(canvasRevisions.userId, userId), eq(canvasRevisions.documentId, documentId)));
  const now = new Date();
  if (Number(row?.n ?? 0) === 0) {
    await db.insert(canvasRevisions).values({
      userId,
      documentId,
      summary: CANVAS_HISTORY_BASELINE,
      snapshot: storedSnapshot(before),
      createdAt: new Date(now.getTime() - 1),
    });
  }
  await db.insert(canvasRevisions).values({
    userId,
    documentId,
    summary: clipSummary(summaryOverride ?? auto),
    snapshot: storedSnapshot(after),
    createdAt: now,
  });
  await trimCanvasRevisions(db, userId, documentId);
}

function toRevision(
  row: { id: string; summary: string; createdAt: Date },
  current: boolean,
): CanvasRevision {
  return {
    id: row.id,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    current,
  };
}

export async function listCanvasRevisions(
  userId: string,
  documentId: string,
): Promise<CanvasRevision[]> {
  await getOwnedDocument(userId, documentId);
  const db = getDb();
  const rows = await db
    .select({
      id: canvasRevisions.id,
      summary: canvasRevisions.summary,
      createdAt: canvasRevisions.createdAt,
    })
    .from(canvasRevisions)
    .where(and(eq(canvasRevisions.userId, userId), eq(canvasRevisions.documentId, documentId)))
    .orderBy(desc(canvasRevisions.createdAt), desc(canvasRevisions.id))
    .limit(CANVAS_HISTORY_LIMIT);

  let currentId: string | null = null;
  const latest = rows[0];
  if (latest) {
    const [stored] = await db
      .select({ snapshot: canvasRevisions.snapshot })
      .from(canvasRevisions)
      .where(eq(canvasRevisions.id, latest.id))
      .limit(1);
    const parsed = canvasSnapshotSchema.safeParse(stored?.snapshot);
    if (parsed.success) {
      const live = await readCanvasHistoryState(db, userId, documentId);
      if (canvasRevisionMatches(normalizeCanvasSnapshot(parsed.data), live)) currentId = latest.id;
    }
  }
  return rows.map((row) => toRevision(row, row.id === currentId));
}

async function loadNotes(
  db: RevisionDb,
  userId: string,
  documentId: string,
): Promise<NoteRow[]> {
  return db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      documentId: annotations.documentId,
      kind: annotations.kind,
      quote: annotations.quote,
      note: annotations.note,
      imageKey: annotations.imageKey,
      anchorBlockIndex: annotations.anchorBlockIndex,
      deletedAt: annotations.deletedAt,
    })
    .from(annotations)
    .where(and(eq(annotations.userId, userId), eq(annotations.documentId, documentId)));
}

async function applySnapshot(
  db: RevisionDb,
  userId: string,
  documentId: string,
  current: readonly CanvasSnapshotNode[],
  targetNodes: readonly CanvasSnapshotNode[],
  targetNotes: CanvasHistoryState['annotations'] | null,
  notes: readonly NoteRow[],
): Promise<{ archivedIds: string[]; revived: NoteRow[] }> {
  const plan = planCanvasRestore(current, targetNodes, {
    cardIds: new Set(
      (
        await db
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId)))
      ).map((row) => row.id),
    ),
    annotationIds: new Set(notes.map((row) => row.id)),
  });
  const now = new Date();
  if (plan.deleteIds.length > 0) {
    await db.delete(canvasNodes).where(
      and(
        eq(canvasNodes.userId, userId),
        eq(canvasNodes.documentId, documentId),
        inArray(canvasNodes.id, plan.deleteIds),
      ),
    );
  }
  if (plan.insert.length > 0) {
    await db.insert(canvasNodes).values(
      plan.insert.map((node) => ({
        id: node.id,
        userId,
        documentId,
        kind: node.kind,
        cardId: node.kind === 'card' ? node.id : null,
        annotationId: node.kind === 'annotation' ? node.id : null,
        text: node.kind === 'text' ? node.text : null,
        imageKey: node.kind === 'image' ? node.imageKey : null,
        parentId: null,
        position: node.position,
      })),
    );
  }
  for (const node of [...plan.insert, ...plan.update]) {
    await db
      .update(canvasNodes)
      .set({
        parentId: node.parentId,
        position: node.position,
        text: node.kind === 'text' ? node.text : null,
        imageKey: node.kind === 'image' ? node.imageKey : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(canvasNodes.id, node.id),
          eq(canvasNodes.userId, userId),
          eq(canvasNodes.documentId, documentId),
        ),
      );
  }
  for (const outline of cardOutlinesAfterRestore(current, plan.final)) {
    await db
      .update(cards)
      .set({
        outlineParentId: outline.parentId,
        outlinePosition: outline.position,
        updatedAt: now,
      })
      .where(and(eq(cards.id, outline.id), eq(cards.userId, userId)));
  }

  const revived: NoteRow[] = [];
  if (targetNotes) {
    const byId = new Map(notes.map((row) => [row.id, row]));
    for (const note of targetNotes) {
      const row = byId.get(note.id);
      if (!row) continue;
      const imageKey = note.imageKey ?? null;
      const nextQuote = note.quote;
      const nextAnchor = note.anchorBlockIndex;
      const quoteSame = nextQuote === undefined || row.quote === nextQuote;
      const anchorSame =
        nextAnchor === undefined || (row.anchorBlockIndex ?? null) === nextAnchor;
      if (
        !row.deletedAt &&
        row.note === note.note &&
        (row.imageKey ?? null) === imageKey &&
        quoteSame &&
        anchorSame
      ) {
        continue;
      }
      await db
        .update(annotations)
        .set({
          note: note.note,
          imageKey,
          deletedAt: null,
          updatedAt: now,
          ...(nextQuote !== undefined ? { quote: nextQuote } : {}),
          ...(nextAnchor !== undefined ? { anchorBlockIndex: nextAnchor } : {}),
        })
        .where(and(eq(annotations.id, note.id), eq(annotations.userId, userId)));
      revived.push({
        ...row,
        note: note.note,
        imageKey,
        deletedAt: null,
        quote: nextQuote ?? row.quote,
        anchorBlockIndex: nextAnchor !== undefined ? nextAnchor : row.anchorBlockIndex,
      });
    }
  }
  const archiveIds = planAnnotationRestore(
    notes.filter((row) => !row.deletedAt).map((row) => row.id),
    targetNotes,
  );
  if (archiveIds.length > 0) {
    await db
      .update(annotations)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(annotations.userId, userId), inArray(annotations.id, archiveIds)));
  }
  return { archivedIds: archiveIds, revived };
}

export async function restoreCanvasRevision(
  userId: string,
  documentId: string,
  revisionId: string,
): Promise<CanvasRevision> {
  await getOwnedDocument(userId, documentId);
  const restored = await getDb().transaction(async (tx) => {
    const [rev] = await tx
      .select()
      .from(canvasRevisions)
      .where(
        and(
          eq(canvasRevisions.id, revisionId),
          eq(canvasRevisions.userId, userId),
          eq(canvasRevisions.documentId, documentId),
        ),
      )
      .limit(1);
    if (!rev) throw new AppError(404, 'NOT_FOUND', '找不到这一版脑图');
    const parsed = canvasSnapshotSchema.safeParse(rev.snapshot);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', '这一版脑图已经读不出来');
    const stored = normalizeCanvasSnapshot(parsed.data);
    const before = await readCanvasHistoryState(tx, userId, documentId);
    if (canvasRevisionMatches(stored, before)) {
      return { revision: toRevision(rev, true), archivedIds: [], revived: [] };
    }
    const notes = await loadNotes(tx, userId, documentId);
    const applied = await applySnapshot(
      tx,
      userId,
      documentId,
      before.nodes,
      stored.nodes,
      stored.annotations,
      notes,
    );
    await commitCanvasRevision(
      tx,
      userId,
      documentId,
      before,
      restoreCanvasSummary(rev.summary, rev.createdAt),
    );
    const [created] = await tx
      .select({
        id: canvasRevisions.id,
        summary: canvasRevisions.summary,
        createdAt: canvasRevisions.createdAt,
      })
      .from(canvasRevisions)
      .where(and(eq(canvasRevisions.userId, userId), eq(canvasRevisions.documentId, documentId)))
      .orderBy(desc(canvasRevisions.createdAt), desc(canvasRevisions.id))
      .limit(1);
    if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
    return { revision: toRevision(created, true), ...applied };
  });
  await Promise.all([
    ...restored.archivedIds.map((id) => tryDeleteAnnotationFromIndex(id)),
    ...restored.revived.map((row) =>
      tryIndexAnnotation({
        id: row.id,
        userId: row.userId,
        documentId: row.documentId,
        kind: row.kind,
        quote: row.quote,
        note: row.note,
      }),
    ),
  ]);
  return restored.revision;
}
