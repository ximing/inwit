import {
  ANNOTATION_RESURFACE_KEY_PREFIX,
  annotationResurfaceJobPayloadFrom,
  cardInputFromAnnotation,
  type AcceptAnnotationResurfaceResponse,
  type AnnotationResurface,
  type AnnotationResurfaceContent,
  type Job,
} from '@inwit/dto';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  annotations,
  cards,
  documents,
  jobs,
  memories,
  users,
  type JobRow,
  type MemoryRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { tryIndexCard } from '../retrieval/pipeline.js';
import { insertInitialReviewState } from '../review/state-init.js';
import { loadAnnotationsByIds } from '../search/search.service.js';
import { localDateKey } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import { toPublicCardBase } from '../cards/card.mapper.js';
import {
  normalizeResurfaceKey,
  parseResurfaceContent,
  pickResurfaceAnnotations,
  resurfaceKeyForDate,
  resurfaceTerminalStatus,
  RESURFACE_AGE_MS,
  type CandidateCardHint,
  type ResurfaceCandidate,
} from './resurface-logic.js';

const AUTO_BLOCK_STATUSES = ['pending', 'running', 'done'] as const;
const CANDIDATE_SCAN_LIMIT = 50;

/** Smoke / ops: skip the hourly resurface scan (manual processing still works). */
export function resurfaceScanEnabled(): boolean {
  const raw = process.env.INWIT_SKIP_RESURFACE_SCAN;
  return raw !== '1' && raw !== 'true';
}

export async function findResurfaceJobsForDate(
  db: Pick<Database, 'select'>,
  userId: string,
  date: string,
  statuses?: ReadonlyArray<JobRow['status']>,
): Promise<JobRow[]> {
  const conditions = [
    eq(jobs.userId, userId),
    eq(jobs.type, 'annotation_resurface' as const),
    sql`${jobs.payload}->>'date' = ${date}`,
  ];
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(jobs.status, [...statuses]));
  }
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));
}

export async function maybeEnqueueAnnotationResurface(
  db: Pick<Database, 'select' | 'insert'>,
  userId: string,
  now = new Date(),
): Promise<JobRow | null> {
  const date = localDateKey(now);
  const existing = await findResurfaceJobsForDate(db, userId, date, AUTO_BLOCK_STATUSES);
  if (existing.length > 0) return existing[0] ?? null;
  return enqueueJob(db, {
    userId,
    type: 'annotation_resurface',
    payload: { date },
  });
}

export async function scanAndEnqueueAnnotationResurface(now = new Date()): Promise<number> {
  const db = getDb();
  const allUsers = await db.select({ id: users.id }).from(users);
  let created = 0;
  for (const user of allUsers) {
    try {
      const existing = await findResurfaceJobsForDate(db, user.id, localDateKey(now), [
        'pending',
        'running',
        'done',
      ]);
      if (existing.length > 0) continue;
      await maybeEnqueueAnnotationResurface(db, user.id, now);
      created += 1;
    } catch (err) {
      logger.warn('resurface.scan_user_failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return created;
}

async function loadResurfaceRows(userId: string): Promise<MemoryRow[]> {
  const rows = await getDb()
    .select()
    .from(memories)
    .where(
      and(eq(memories.userId, userId), eq(memories.scope, 'user'), eq(memories.layer, 'profile')),
    )
    .orderBy(desc(memories.createdAt), desc(memories.id));
  return rows.filter((row) => row.key.startsWith(ANNOTATION_RESURFACE_KEY_PREFIX));
}

async function loadSuggestedIds(userId: string): Promise<Set<string>> {
  const rows = await loadResurfaceRows(userId);
  const ids = new Set<string>();
  for (const row of rows) {
    const content = parseResurfaceContent(row.content);
    if (!content) continue;
    for (const id of content.annotationIds) ids.add(id);
  }
  return ids;
}

async function loadResurfaceCandidates(
  userId: string,
  now: Date,
): Promise<ResurfaceCandidate[]> {
  const cutoff = new Date(now.getTime() - RESURFACE_AGE_MS);
  return getDb()
    .select({
      id: annotations.id,
      documentId: annotations.documentId,
      quote: annotations.quote,
      note: annotations.note,
      imageKey: annotations.imageKey,
      anchorBlockIndex: annotations.anchorBlockIndex,
      createdAt: annotations.createdAt,
    })
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        isNull(annotations.convertedCardId),
        isNull(annotations.deletedAt),
        ne(annotations.note, ''),
        lt(annotations.createdAt, cutoff),
      ),
    )
    .orderBy(asc(annotations.createdAt), asc(annotations.id))
    .limit(CANDIDATE_SCAN_LIMIT);
}

async function loadCardHints(userId: string, documentIds: string[]): Promise<CandidateCardHint[]> {
  if (documentIds.length === 0) return [];
  return getDb()
    .select({
      documentId: cards.documentId,
      imageKey: cards.imageKey,
      anchorBlockIndex: cards.anchorBlockIndex,
      anchorText: cards.anchorText,
    })
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.documentId, documentIds), isNull(cards.deletedAt)));
}

/** Deterministic daily job: pick stale unconverted annotations and store the suggestion. */
export async function processAnnotationResurface(job: JobRow): Promise<void> {
  const payload = annotationResurfaceJobPayloadFrom(job.payload);
  if (!payload) throw new Error('invalid annotation_resurface payload');
  const now = new Date();
  const [candidates, suggestedIds] = await Promise.all([
    loadResurfaceCandidates(job.userId, now),
    loadSuggestedIds(job.userId),
  ]);
  const documentIds = [...new Set(candidates.map((row) => row.documentId))];
  const cardHints = await loadCardHints(job.userId, documentIds);
  const picked = pickResurfaceAnnotations({ candidates, cardHints, suggestedIds, now });
  if (picked.length === 0) {
    logger.info('resurface.empty', { jobId: job.id, userId: job.userId });
    return;
  }
  const content: AnnotationResurfaceContent = {
    annotationIds: picked.map((row) => row.id),
    status: 'pending',
  };
  try {
    await getDb().insert(memories).values({
      userId: job.userId,
      scope: 'user',
      scopeId: null,
      layer: 'profile',
      key: resurfaceKeyForDate(payload.date),
      content,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.info('resurface.duplicate', { jobId: job.id, userId: job.userId });
      return;
    }
    throw err;
  }
  logger.info('resurface.suggested', {
    jobId: job.id,
    userId: job.userId,
    count: picked.length,
  });
}

async function getResurfaceRow(
  userId: string,
  rawKey: string,
): Promise<{ row: MemoryRow; content: AnnotationResurfaceContent }> {
  const key = normalizeResurfaceKey(rawKey);
  if (!key) throw AppError.of(400, 'VALIDATION_ERROR');
  const [row] = await getDb()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.scope, 'user'),
        eq(memories.layer, 'profile'),
        eq(memories.key, key),
      ),
    )
    .limit(1);
  if (!row) throw AppError.of(404, 'RESURFACE_NOT_FOUND');
  const content = parseResurfaceContent(row.content);
  if (!content) throw AppError.of(404, 'RESURFACE_NOT_FOUND');
  return { row, content };
}

async function updateResurfaceContent(
  rowId: string,
  content: AnnotationResurfaceContent,
  now: Date,
): Promise<void> {
  await getDb().update(memories).set({ content, updatedAt: now }).where(eq(memories.id, rowId));
}

async function convertedAnnotationIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.userId, userId),
        inArray(annotations.id, ids),
        isNull(annotations.deletedAt),
        sql`${annotations.convertedCardId} IS NOT NULL`,
      ),
    );
  return new Set(rows.map((row) => row.id));
}

function toPublicResurface(
  row: MemoryRow,
  content: AnnotationResurfaceContent,
  items: AnnotationResurface['annotations'],
): AnnotationResurface {
  return {
    key: row.key,
    status: content.status,
    createdAt: row.createdAt.toISOString(),
    annotations: items,
  };
}

/** Latest actionable resurface suggestion; resolves stale entries lazily. */
export async function getAnnotationResurface(userId: string): Promise<AnnotationResurface | null> {
  const rows = await loadResurfaceRows(userId);
  for (const row of rows) {
    const content = parseResurfaceContent(row.content);
    if (!content || content.status !== 'pending') continue;
    const converted = await convertedAnnotationIds(userId, content.annotationIds);
    const remainingIds = content.annotationIds.filter((id) => !converted.has(id));
    if (remainingIds.length === 0) {
      await updateResurfaceContent(row.id, { ...content, status: resurfaceTerminalStatus(content) }, new Date());
      continue;
    }
    const items = await loadAnnotationsByIds(userId, remainingIds);
    if (items.length === 0) {
      await updateResurfaceContent(row.id, { ...content, status: resurfaceTerminalStatus(content) }, new Date());
      continue;
    }
    return toPublicResurface(row, content, items);
  }
  return null;
}

export async function dismissAnnotationResurface(userId: string, key: string): Promise<void> {
  const { row, content } = await getResurfaceRow(userId, key);
  if (content.status === 'accepted') throw AppError.of(409, 'RESURFACE_NOT_PENDING');
  if (content.status === 'dismissed') return;
  await updateResurfaceContent(
    row.id,
    { ...content, status: 'dismissed', dismissedAt: new Date().toISOString() },
    new Date(),
  );
}

/** Convert one suggested annotation into a card, server-side, atomically. */
export async function acceptAnnotationResurface(
  userId: string,
  key: string,
  annotationId: string,
): Promise<AcceptAnnotationResurfaceResponse> {
  const { row, content } = await getResurfaceRow(userId, key);
  if (content.status !== 'pending') throw AppError.of(409, 'RESURFACE_NOT_PENDING');
  if (!content.annotationIds.includes(annotationId)) throw AppError.of(400, 'VALIDATION_ERROR');

  const [annotation] = await getDb()
    .select()
    .from(annotations)
    .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId), isNull(annotations.deletedAt)))
    .limit(1);
  if (!annotation) throw AppError.of(404, 'ANNOTATION_NOT_FOUND');
  if (annotation.convertedCardId) throw AppError.of(409, 'ANNOTATION_ALREADY_CONVERTED');

  const input = cardInputFromAnnotation({
    id: annotation.id,
    documentId: annotation.documentId,
    note: annotation.note,
    quote: annotation.quote,
    imageKey: annotation.imageKey,
    anchorBlockIndex: annotation.anchorBlockIndex,
  });
  if (!input) throw AppError.of(400, 'VALIDATION_ERROR');

  const [document] = await getDb()
    .select({ id: documents.id, topicId: documents.topicId })
    .from(documents)
    .where(
      and(
        eq(documents.id, annotation.documentId),
        eq(documents.userId, userId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  if (!document) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');

  const now = new Date();
  const created = await getDb().transaction(async (tx) => {
    const [cardRow] = await tx
      .insert(cards)
      .values({
        userId,
        documentId: document.id,
        topicId: document.topicId,
        concept: input.concept,
        example: input.example,
        confusionPoint: '',
        tags: [],
        source: 'manual',
        anchorText: input.anchorText ?? null,
        anchorBlockIndex: input.anchorBlockIndex ?? null,
        imageKey: input.imageKey ?? null,
      })
      .returning();
    if (!cardRow) throw AppError.of(500, 'INTERNAL_ERROR');
    await insertInitialReviewState(userId, cardRow.id, now, tx, now);
    await tx
      .update(annotations)
      .set({ convertedCardId: cardRow.id, updatedAt: now })
      .where(and(eq(annotations.id, annotation.id), eq(annotations.userId, userId)));

    const acceptedCardIds = [...(content.acceptedCardIds ?? []), cardRow.id];
    const nextContent: AnnotationResurfaceContent = {
      ...content,
      acceptedCardIds,
      ...(acceptedCardIds.length >= content.annotationIds.length
        ? { status: 'accepted' as const }
        : {}),
    };
    await tx.update(memories).set({ content: nextContent, updatedAt: now }).where(eq(memories.id, row.id));
    return cardRow;
  });
  await tryIndexCard(created);
  return {
    card: toPublicCardBase(created),
    resurface: await getAnnotationResurface(userId),
  };
}

/** Manual trigger for tests / ops: run today's pick for one user immediately. */
export async function enqueueAnnotationResurface(
  userId: string,
  now = new Date(),
): Promise<{ job: Job; created: boolean }> {
  const existing = await findResurfaceJobsForDate(getDb(), userId, localDateKey(now), [
    'pending',
    'running',
    'done',
  ]);
  if (existing[0]) return { job: toPublicJob(existing[0]), created: false };
  const row = await enqueueJob(getDb(), {
    userId,
    type: 'annotation_resurface',
    payload: { date: localDateKey(now) },
  });
  return { job: toPublicJob(row), created: true };
}
