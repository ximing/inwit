import type { AcceptTopicSuggestionResult, Job, TopicSuggestion, TopicSuggestionContent } from '@inwit/dto';
import {
  TOPIC_SUGGESTION_KEY_PREFIX,
  TOPIC_SUGGESTION_MIN_DOCS,
  topicSuggestionSlugSchema,
} from '@inwit/dto';
import { and, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { cards, documents, jobs, memories, topics, type MemoryRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { enqueueJob } from '../jobs/enqueue.js';
import {
  SUGGEST_EXPIRE_MS,
  SUGGEST_LOOKBACK_MS,
  decideSuggestionWrite,
  parseSuggestionContent,
  slugifySuggestionTitle,
  suggestionKeyFromSlug,
  type SuggestionMemoryView,
} from './suggest-logic.js';
import { toPublicTopic } from './topic.service.js';

export function normalizeSuggestionKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith(TOPIC_SUGGESTION_KEY_PREFIX)) {
    const slug = trimmed.slice(TOPIC_SUGGESTION_KEY_PREFIX.length);
    const parsed = topicSuggestionSlugSchema.safeParse(slug);
    if (!parsed.success) throw AppError.of(400, 'VALIDATION_ERROR');
    return suggestionKeyFromSlug(parsed.data);
  }
  const parsed = topicSuggestionSlugSchema.safeParse(trimmed);
  if (!parsed.success) throw AppError.of(400, 'VALIDATION_ERROR');
  return suggestionKeyFromSlug(parsed.data);
}

function toPublicSuggestion(row: MemoryRow, content: TopicSuggestionContent): TopicSuggestion {
  return {
    key: row.key,
    title: content.title,
    reason: content.reason,
    documentIds: content.documentIds,
    documentCount: content.documentIds.length,
    status: content.status,
    topicId: content.topicId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadSuggestionRows(userId: string): Promise<MemoryRow[]> {
  const rows = await getDb()
    .select()
    .from(memories)
    .where(
      and(eq(memories.userId, userId), eq(memories.scope, 'user'), eq(memories.layer, 'profile')),
    )
    .orderBy(desc(memories.updatedAt), desc(memories.id));
  return rows.filter((row) => row.key.startsWith(TOPIC_SUGGESTION_KEY_PREFIX));
}

export function viewsFromRows(rows: MemoryRow[]): SuggestionMemoryView[] {
  const views: SuggestionMemoryView[] = [];
  for (const row of rows) {
    const content = parseSuggestionContent(row.content);
    if (!content) continue;
    views.push({
      key: row.key,
      title: content.title,
      status: content.status,
      documentIds: content.documentIds,
      dismissedAt: content.dismissedAt ?? null,
      createdAt: row.createdAt,
    });
  }
  return views;
}

export async function countUnattributedDigested(userId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUGGEST_LOOKBACK_MS);
  const [row] = await getDb()
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        isNull(documents.topicId),
        eq(documents.status, 'digested'),
        isNull(documents.deletedAt),
        gte(documents.createdAt, cutoff),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function loadUnattributedPool(
  userId: string,
  now = new Date(),
): Promise<{
  documents: { id: string; title: string; createdAt: string; concepts: string[] }[];
  activeTopics: { id: string; title: string; goal: string | null }[];
  existingSuggestions: SuggestionMemoryView[];
}> {
  const cutoff = new Date(now.getTime() - SUGGEST_LOOKBACK_MS);
  const docRows = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        isNull(documents.topicId),
        eq(documents.status, 'digested'),
        isNull(documents.deletedAt),
        gte(documents.createdAt, cutoff),
      ),
    )
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(40);

  const docIds = docRows.map((row) => row.id);
  const conceptsByDoc = new Map<string, string[]>();
  if (docIds.length > 0) {
    const cardRows = await getDb()
      .select({ documentId: cards.documentId, concept: cards.concept })
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          inArray(cards.documentId, docIds),
          eq(cards.acceptance, 'accepted'),
          isNull(cards.deletedAt),
        ),
      );
    for (const row of cardRows) {
      if (!row.documentId) continue;
      const list = conceptsByDoc.get(row.documentId) ?? [];
      if (list.length >= 6) continue;
      list.push(row.concept.slice(0, 80));
      conceptsByDoc.set(row.documentId, list);
    }
  }

  const activeTopics = await getDb()
    .select({ id: topics.id, title: topics.title, goal: topics.goal })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, 'active')));

  const existingSuggestions = viewsFromRows(await loadSuggestionRows(userId));

  return {
    documents: docRows.map((row) => ({
      id: row.id,
      title: (row.title ?? '').slice(0, 80),
      createdAt: row.createdAt.toISOString(),
      concepts: conceptsByDoc.get(row.id) ?? [],
    })),
    activeTopics,
    existingSuggestions,
  };
}

export async function findActiveSuggestJob(userId: string): Promise<Job | null> {
  const matches = await getDb()
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'topic'),
        inArray(jobs.status, ['pending', 'running']),
      ),
    )
    .orderBy(desc(jobs.createdAt));
  const hit = matches.find((job) => job.payload.action === 'suggest');
  return hit ? toPublicJob(hit) : null;
}

export async function enqueueSuggestScan(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<{ job: Job; created: boolean }> {
  const existing = await findActiveSuggestJob(userId);
  if (existing) return { job: existing, created: false };
  if (!opts.force) {
    const n = await countUnattributedDigested(userId);
    if (n < TOPIC_SUGGESTION_MIN_DOCS) {
      throw AppError.of(409, 'SUGGEST_SCAN_TOO_FEW');
    }
    const pending = (await listTopicSuggestions(userId)).length;
    if (pending > 0) throw AppError.of(409, 'SUGGESTION_ALREADY_PENDING');
  }
  const row = await enqueueJob(getDb(), {
    userId,
    type: 'topic',
    payload: { action: 'suggest' },
  });
  return { job: toPublicJob(row), created: true };
}

const SUGGEST_DEBOUNCE_MS = 12_000;

export async function maybeEnqueueTopicSuggest(userId: string): Promise<Job | null> {
  try {
    const existing = await findActiveSuggestJob(userId);
    if (existing) return existing;
    const n = await countUnattributedDigested(userId);
    if (n < TOPIC_SUGGESTION_MIN_DOCS) return null;
    if ((await listTopicSuggestions(userId)).length > 0) return null;
    const row = await enqueueJob(getDb(), {
      userId,
      type: 'topic',
      payload: { action: 'suggest' },
      runAt: new Date(Date.now() + SUGGEST_DEBOUNCE_MS),
    });
    return toPublicJob(row);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'SUGGEST_SCAN_TOO_FEW' || err.code === 'SUGGESTION_ALREADY_PENDING')) {
      return null;
    }
    throw err;
  }
}

async function markDismissed(row: MemoryRow, content: TopicSuggestionContent, now: Date): Promise<void> {
  const next: TopicSuggestionContent = {
    ...content,
    status: 'dismissed',
    dismissedAt: now.toISOString(),
  };
  await getDb()
    .update(memories)
    .set({ content: next, updatedAt: now })
    .where(eq(memories.id, row.id));
}

export async function listTopicSuggestions(userId: string, now = new Date()): Promise<TopicSuggestion[]> {
  const rows = await loadSuggestionRows(userId);
  const items: TopicSuggestion[] = [];
  for (const row of rows) {
    const content = parseSuggestionContent(row.content);
    if (!content) continue;
    if (content.status === 'pending' && now.getTime() - row.createdAt.getTime() > SUGGEST_EXPIRE_MS) {
      await markDismissed(row, content, now);
      continue;
    }
    if (content.status !== 'pending') continue;
    items.push(toPublicSuggestion(row, content));
  }
  return items;
}

export async function writeTopicSuggestion(input: {
  userId: string;
  title: string;
  slug?: string;
  reason: string;
  documentIds: string[];
  now?: Date;
}): Promise<{ ok: true; key: string } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  const title = input.title.trim();
  if (title.length === 0) return { ok: false, reason: 'empty title' };
  const slugParsed = input.slug
    ? topicSuggestionSlugSchema.safeParse(input.slug.trim())
    : { success: true as const, data: slugifySuggestionTitle(title) };
  if (!slugParsed.success) return { ok: false, reason: 'invalid slug' };
  const slug = slugParsed.data;
  const key = suggestionKeyFromSlug(slug);

  const uniqueIds = [...new Set(input.documentIds)];
  const owned = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, input.userId),
        isNull(documents.topicId),
        isNull(documents.deletedAt),
        inArray(documents.id, uniqueIds),
      ),
    );
  const ownedIds = owned.map((row) => row.id);
  if (ownedIds.length < TOPIC_SUGGESTION_MIN_DOCS) {
    return { ok: false, reason: `need at least ${String(TOPIC_SUGGESTION_MIN_DOCS)} unattributed documents` };
  }

  const pool = await loadUnattributedPool(input.userId, now);
  const decision = decideSuggestionWrite({
    title,
    slug,
    documentIds: ownedIds,
    now,
    existing: pool.existingSuggestions,
    activeTopicTitles: pool.activeTopics.map((topic) => topic.title),
  });
  if (!decision.ok) return decision;

  const content: TopicSuggestionContent = {
    title: title.slice(0, 200),
    reason: input.reason.trim().slice(0, 2000),
    documentIds: ownedIds,
    status: 'pending',
    slug,
  };

  const [existing] = await getDb()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, input.userId),
        eq(memories.scope, 'user'),
        eq(memories.layer, 'profile'),
        eq(memories.key, key),
      ),
    )
    .limit(1);

  try {
    if (existing) {
      await getDb()
        .update(memories)
        .set({ content, updatedAt: now })
        .where(eq(memories.id, existing.id));
    } else {
      await getDb().insert(memories).values({
        userId: input.userId,
        scope: 'user',
        scopeId: null,
        layer: 'profile',
        key,
        content,
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'already pending' };
    throw err;
  }
  return { ok: true, key };
}

async function getSuggestionRow(
  userId: string,
  key: string,
): Promise<{ row: MemoryRow; content: TopicSuggestionContent }> {
  const normalized = normalizeSuggestionKey(key);
  const [row] = await getDb()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.scope, 'user'),
        eq(memories.layer, 'profile'),
        eq(memories.key, normalized),
      ),
    )
    .limit(1);
  if (!row) throw AppError.of(404, 'SUGGESTION_NOT_FOUND');
  const content = parseSuggestionContent(row.content);
  if (!content) throw AppError.of(404, 'SUGGESTION_NOT_FOUND');
  return { row, content };
}

export async function dismissTopicSuggestion(userId: string, key: string): Promise<TopicSuggestion> {
  const { row, content } = await getSuggestionRow(userId, key);
  if (content.status === 'accepted') throw AppError.of(409, 'SUGGESTION_NOT_PENDING');
  const now = new Date();
  if (content.status === 'pending') {
    await markDismissed(row, content, now);
  }
  const [updated] = await getDb().select().from(memories).where(eq(memories.id, row.id)).limit(1);
  if (!updated) throw AppError.of(404, 'SUGGESTION_NOT_FOUND');
  const next = parseSuggestionContent(updated.content) ?? { ...content, status: 'dismissed' as const };
  return toPublicSuggestion(updated, next);
}

export async function acceptTopicSuggestion(
  userId: string,
  key: string,
): Promise<AcceptTopicSuggestionResult> {
  const { row, content } = await getSuggestionRow(userId, key);
  if (content.status !== 'pending') throw AppError.of(409, 'SUGGESTION_NOT_PENDING');

  const result = await getDb().transaction(async (tx) => {
    const now = new Date();
    const [topic] = await tx
      .insert(topics)
      .values({
        userId,
        title: content.title.slice(0, 200),
        goal: content.reason.slice(0, 4000),
        status: 'active',
      })
      .returning();
    if (!topic) throw AppError.of(500, 'INTERNAL_ERROR');

    if (content.documentIds.length > 0) {
      await tx
        .update(documents)
        .set({ topicId: topic.id, updatedAt: now })
        .where(
          and(
            eq(documents.userId, userId),
            isNull(documents.topicId),
            isNull(documents.deletedAt),
            inArray(documents.id, content.documentIds),
          ),
        );
      await tx
        .update(cards)
        .set({ topicId: topic.id, updatedAt: now })
        .where(
          and(
            eq(cards.userId, userId),
            isNull(cards.topicId),
            isNull(cards.deletedAt),
            inArray(cards.documentId, content.documentIds),
          ),
        );
    }

    const accepted: TopicSuggestionContent = {
      ...content,
      status: 'accepted',
      topicId: topic.id,
    };
    const [memory] = await tx
      .update(memories)
      .set({ content: accepted, updatedAt: now })
      .where(eq(memories.id, row.id))
      .returning();
    if (!memory) throw AppError.of(404, 'SUGGESTION_NOT_FOUND');

    const jobRow = await enqueueJob(tx, {
      userId,
      type: 'topic',
      payload: { topicId: topic.id, action: 'organize' },
    });

    return {
      topic: toPublicTopic(topic),
      job: toPublicJob(jobRow),
      suggestion: toPublicSuggestion(memory, accepted),
    };
  });

  return result;
}
