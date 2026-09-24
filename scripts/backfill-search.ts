import { isNull } from 'drizzle-orm';
import { planSearchBackfill, shouldIndexCard } from '../apps/server/src/cards/card-acceptance-logic.js';
import { getDb, pool } from '../apps/server/src/db/index.js';
import { annotations, cards, documents } from '../apps/server/src/db/schema.js';
import { deleteCardFromIndex, indexAnnotation, indexCard, indexDocument } from '../apps/server/src/retrieval/pipeline.js';
import {
  annotationsStoreName,
  cardsStoreName,
  docsStoreName,
  ensureRetrievalStores,
  getRetrievalClients,
} from '../apps/server/src/retrieval/registry.js';

function failMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

try {
  await ensureRetrievalStores();
  const db = getDb();
  const { meili } = getRetrievalClients();
  const docsName = docsStoreName();
  const cardsName = cardsStoreName();
  const annotationsName = annotationsStoreName();
  console.log(`stores ${docsName} ${cardsName} ${annotationsName}`);

  const docs = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      topicId: documents.topicId,
      title: documents.title,
      description: documents.description,
      contentJson: documents.contentJson,
    })
    .from(documents);

  let docOk = 0;
  let docFail = 0;
  for (const [i, doc] of docs.entries()) {
    try {
      await indexDocument(doc);
      docOk += 1;
    } catch (err) {
      docFail += 1;
      console.error(`doc fail ${doc.id}: ${failMessage(err)}`);
    }
    if ((i + 1) % 20 === 0 || i + 1 === docs.length) {
      console.log(`docs ${String(i + 1)}/${String(docs.length)} ok=${String(docOk)} fail=${String(docFail)}`);
    }
  }

  let indexedCardIds = new Set<string>();
  try {
    indexedCardIds = new Set(await meili.listIds(cardsName));
  } catch (err) {
    console.warn(`list card ids failed, reindexing all cards: ${failMessage(err)}`);
  }

  const cardRows = await db
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
    .from(cards);

  const plan = planSearchBackfill({
    indexedIds: [...indexedCardIds],
    cards: cardRows,
  });

  let cardDeleted = 0;
  let cardDeleteFail = 0;
  for (const id of plan.deleteIds) {
    try {
      await deleteCardFromIndex(id);
      cardDeleted += 1;
    } catch (err) {
      cardDeleteFail += 1;
      console.error(`card delete fail ${id}: ${failMessage(err)}`);
    }
  }

  const cardsById = new Map(cardRows.map((row) => [row.id, row]));
  let cardOk = 0;
  let cardFail = 0;
  for (const [i, id] of plan.indexIds.entries()) {
    const card = cardsById.get(id);
    if (!card) continue;
    try {
      await indexCard(card);
      cardOk += 1;
    } catch (err) {
      cardFail += 1;
      console.error(`card fail ${card.id}: ${failMessage(err)}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === plan.indexIds.length) {
      console.log(
        `cards index ${String(i + 1)}/${String(plan.indexIds.length)} ok=${String(cardOk)} fail=${String(cardFail)}`,
      );
    }
  }
  const cardSkip = cardRows.filter((row) => shouldIndexCard(row) && indexedCardIds.has(row.id)).length;

  let indexedAnnotationIds = new Set<string>();
  try {
    indexedAnnotationIds = new Set(await meili.listIds(annotationsName));
  } catch (err) {
    console.warn(`list annotation ids failed, reindexing all annotations: ${failMessage(err)}`);
  }

  const annotationRows = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      documentId: annotations.documentId,
      kind: annotations.kind,
      quote: annotations.quote,
      note: annotations.note,
    })
    .from(annotations)
    .where(isNull(annotations.deletedAt));

  let annotationOk = 0;
  let annotationSkip = 0;
  let annotationFail = 0;
  for (const [i, annotation] of annotationRows.entries()) {
    if (indexedAnnotationIds.has(annotation.id)) {
      annotationSkip += 1;
    } else {
      try {
        await indexAnnotation(annotation);
        annotationOk += 1;
      } catch (err) {
        annotationFail += 1;
        console.error(`annotation fail ${annotation.id}: ${failMessage(err)}`);
      }
    }
    if ((i + 1) % 50 === 0 || i + 1 === annotationRows.length) {
      console.log(
        `annotations ${String(i + 1)}/${String(annotationRows.length)} ok=${String(annotationOk)} skip=${String(annotationSkip)} fail=${String(annotationFail)}`,
      );
    }
  }

  console.log(
    JSON.stringify({
      documents: { total: docs.length, ok: docOk, fail: docFail },
      cards: {
        total: cardRows.length,
        ok: cardOk,
        skip: cardSkip,
        deleted: cardDeleted,
        fail: cardFail + cardDeleteFail,
      },
      annotations: {
        total: annotationRows.length,
        ok: annotationOk,
        skip: annotationSkip,
        fail: annotationFail,
      },
      stores: { documents: docsName, cards: cardsName, annotations: annotationsName },
    }),
  );
  if (docFail > 0 || cardFail > 0 || cardDeleteFail > 0 || annotationFail > 0) process.exitCode = 1;
} catch (err) {
  console.error('backfill failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
