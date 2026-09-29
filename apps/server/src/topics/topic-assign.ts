import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { shouldIndexCard } from '../cards/card-acceptance-logic.js';
import { getDb } from '../db/index.js';
import { cards, documents, mapNodes, topics } from '../db/schema.js';
import { tryIndexCard, hybridSearchRanked } from '../retrieval/pipeline.js';
import { cardsStoreName, docsStoreName, ensureRetrievalStores, getRetrievalClients } from '../retrieval/registry.js';
import { logger } from '../utils/logger.js';
import {
  TOPIC_ASSIGN_ABSTAIN_ID,
  TOPIC_ASSIGN_ABSTAIN_TEXT,
  accumulateTopicHits,
  assignmentQueryUsable,
  buildAssignmentQuery,
  buildTopicDossier,
  chooseTopicAssignment,
  shortlistTopics,
  type TopicRelevance,
} from './topic-assign-logic.js';

const CARD_HITS = 24;
const DOC_HITS = 12;

export interface TopicAssignOutcome {
  topicId: string | null;
  title: string | null;
  assigned: boolean;
  reason: 'rerank' | 'rerank_hits' | 'hits' | 'existing' | 'empty' | 'none';
  relevance: number | null;
  abstain: number | null;
  runnerUp: number | null;
  hitCount: number;
}

function outcome(partial: Partial<TopicAssignOutcome> & Pick<TopicAssignOutcome, 'reason'>): TopicAssignOutcome {
  return {
    topicId: null,
    title: null,
    assigned: false,
    relevance: null,
    abstain: null,
    runnerUp: null,
    hitCount: 0,
    ...partial,
  };
}

/** Refresh card vectors after a topic change so the next assignment can see them. */
export async function reindexDocumentCards(userId: string, documentId: string): Promise<void> {
  const rows = await getDb()
    .select({
      id: cards.id,
      userId: cards.userId,
      topicId: cards.topicId,
      concept: cards.concept,
      example: cards.example,
      confusionPoint: cards.confusionPoint,
      tags: cards.tags,
      acceptance: cards.acceptance,
      deletedAt: cards.deletedAt,
    })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.documentId, documentId), isNull(cards.deletedAt)));
  for (const row of rows) {
    if (!shouldIndexCard(row)) continue;
    await tryIndexCard({
      id: row.id,
      userId: row.userId,
      topicId: row.topicId,
      concept: row.concept,
      example: row.example,
      confusionPoint: row.confusionPoint,
      tags: row.tags,
    });
  }
}

/**
 * After digest, file a document that still has no topic.
 * A topic the user already chose (or the digest agent already wrote) is left alone.
 * Retrieval or rerank failures leave the document unassigned.
 */
export async function assignUnscopedDigestedDocument(
  userId: string,
  documentId: string,
): Promise<TopicAssignOutcome> {
  const db = getDb();
  const [doc] = await db
    .select({
      id: documents.id,
      topicId: documents.topicId,
      title: documents.title,
      description: documents.description,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
    .limit(1);
  if (!doc) return outcome({ reason: 'empty' });
  if (doc.topicId) {
    const [topic] = await db
      .select({ title: topics.title })
      .from(topics)
      .where(and(eq(topics.id, doc.topicId), eq(topics.userId, userId)))
      .limit(1);
    return outcome({ reason: 'existing', topicId: doc.topicId, title: topic?.title ?? null });
  }

  const active = await db
    .select({ id: topics.id, title: topics.title, goal: topics.goal })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, 'active')))
    .orderBy(asc(topics.createdAt));
  if (active.length === 0) return outcome({ reason: 'empty' });

  const ownCards = await db
    .select({ concept: cards.concept })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.documentId, documentId),
        isNull(cards.deletedAt),
        ne(cards.acceptance, 'rejected'),
      ),
    )
    .orderBy(asc(cards.createdAt), asc(cards.id));
  const query = buildAssignmentQuery({
    title: doc.title,
    description: doc.description,
    concepts: ownCards.map((row) => row.concept),
  });
  if (!assignmentQueryUsable(query)) return outcome({ reason: 'none' });

  const scoredHits: { topicId: string | null; sourceId: string; score: number | null }[] = [];
  const conceptsByTopic = new Map<string, string[]>();
  try {
    await ensureRetrievalStores();
    const [cardHits, docHits] = await Promise.all([
      hybridSearchRanked({
        storeName: cardsStoreName(),
        userId,
        query,
        limit: CARD_HITS,
      }),
      hybridSearchRanked({
        storeName: docsStoreName(),
        userId,
        query,
        limit: DOC_HITS,
      }),
    ]);
    const cardIds = cardHits.map((hit) => hit.id).filter((id) => id !== '');
    const docIds = docHits.map((hit) => hit.id).filter((id) => id !== '' && id !== documentId);
    const [cardRows, docRows] = await Promise.all([
      cardIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: cards.id,
              topicId: cards.topicId,
              documentId: cards.documentId,
              concept: cards.concept,
            })
            .from(cards)
            .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds), isNull(cards.deletedAt))),
      docIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: documents.id, topicId: documents.topicId })
            .from(documents)
            .where(and(eq(documents.userId, userId), inArray(documents.id, docIds), isNull(documents.deletedAt))),
    ]);
    const cardById = new Map(cardRows.map((row) => [row.id, row]));
    const docById = new Map(docRows.map((row) => [row.id, row]));
    for (const hit of cardHits) {
      const row = cardById.get(hit.id);
      if (!row || row.documentId === documentId) continue;
      scoredHits.push({ topicId: row.topicId, sourceId: row.documentId ?? row.id, score: hit.score });
      if (row.topicId) {
        const list = conceptsByTopic.get(row.topicId) ?? [];
        list.push(row.concept);
        conceptsByTopic.set(row.topicId, list);
      }
    }
    for (const hit of docHits) {
      if (hit.id === documentId) continue;
      const row = docById.get(hit.id);
      if (!row) continue;
      scoredHits.push({ topicId: row.topicId, sourceId: row.id, score: hit.score });
    }
  } catch (err) {
    logger.warn('topic_assign.search_failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const topicHits = accumulateTopicHits(scoredHits);
  const hitScore = new Map(topicHits.map((hit) => [hit.topicId, hit.hitScore]));
  const shortlist = shortlistTopics(active, hitScore, query);
  const nodeRows =
    shortlist.length === 0
      ? []
      : await db
          .select({ topicId: mapNodes.topicId, title: mapNodes.title })
          .from(mapNodes)
          .where(
            inArray(
              mapNodes.topicId,
              shortlist.map((topic) => topic.id),
            ),
          )
          .orderBy(asc(mapNodes.position), asc(mapNodes.createdAt));
  const nodesByTopic = new Map<string, string[]>();
  for (const node of nodeRows) {
    const list = nodesByTopic.get(node.topicId) ?? [];
    list.push(node.title);
    nodesByTopic.set(node.topicId, list);
  }

  const dossierTexts = shortlist.map((topic) =>
    buildTopicDossier({
      title: topic.title,
      goal: topic.goal,
      nodeTitles: nodesByTopic.get(topic.id) ?? [],
      concepts: conceptsByTopic.get(topic.id) ?? [],
    }),
  );
  let relevance: TopicRelevance[] = [];
  try {
    const { rerank } = getRetrievalClients();
    const documentsForRerank = [...dossierTexts, TOPIC_ASSIGN_ABSTAIN_TEXT];
    const ranked = await rerank.rerankTexts(query, documentsForRerank, documentsForRerank.length, { userId });
    const scoreByIndex = new Map(ranked.map((row) => [row.index, row.score]));
    relevance = [
      ...shortlist.map((topic, index) => ({
        topicId: topic.id,
        relevance: scoreByIndex.get(index) ?? null,
      })),
      {
        topicId: TOPIC_ASSIGN_ABSTAIN_ID,
        relevance: scoreByIndex.get(shortlist.length) ?? null,
      },
    ];
  } catch (err) {
    logger.warn('topic_assign.rerank_failed', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const choice = chooseTopicAssignment({ relevance, hits: topicHits });
  const scored = relevance
    .filter(
      (row): row is { topicId: string; relevance: number } =>
        row.topicId !== TOPIC_ASSIGN_ABSTAIN_ID && typeof row.relevance === 'number',
    )
    .sort((a, b) => b.relevance - a.relevance);
  const abstainRow = relevance.find((row) => row.topicId === TOPIC_ASSIGN_ABSTAIN_ID);
  const summary = {
    relevance: choice?.relevance ?? scored[0]?.relevance ?? null,
    abstain: choice?.abstain ?? (typeof abstainRow?.relevance === 'number' ? abstainRow.relevance : null),
    runnerUp: choice?.runnerUp ?? scored[1]?.relevance ?? null,
    hitCount: choice?.hitCount ?? topicHits.reduce((best, hit) => Math.max(best, hit.hitCount), 0),
  };
  if (!choice) return outcome({ reason: 'none', ...summary });

  const topic = active.find((row) => row.id === choice.topicId);
  if (!topic) return outcome({ reason: 'none', ...summary });

  const wrote = await db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(documents)
      .set({ topicId: topic.id, updatedAt: now })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.userId, userId),
          isNull(documents.topicId),
          isNull(documents.deletedAt),
        ),
      )
      .returning({ id: documents.id });
    if (!updated) return false;
    await tx
      .update(cards)
      .set({ topicId: topic.id, updatedAt: now })
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.documentId, documentId),
          isNull(cards.topicId),
          isNull(cards.deletedAt),
        ),
      );
    return true;
  });
  if (!wrote) {
    const [fresh] = await db
      .select({ topicId: documents.topicId })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
      .limit(1);
    if (fresh?.topicId) {
      const [holder] = await db
        .select({ title: topics.title })
        .from(topics)
        .where(eq(topics.id, fresh.topicId))
        .limit(1);
      return outcome({ reason: 'existing', topicId: fresh.topicId, title: holder?.title ?? null });
    }
    return outcome({ reason: 'none', ...summary });
  }

  await reindexDocumentCards(userId, documentId);
  return outcome({
    reason: choice.reason,
    assigned: true,
    topicId: topic.id,
    title: topic.title,
    relevance: choice.relevance,
    abstain: choice.abstain,
    runnerUp: choice.runnerUp,
    hitCount: choice.hitCount,
  });
}
