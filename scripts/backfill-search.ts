import { getDb, pool } from '../apps/server/src/db/index.js';
import { cards, documents } from '../apps/server/src/db/schema.js';
import { indexCard, indexDocument } from '../apps/server/src/retrieval/pipeline.js';
import {
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
  console.log(`stores ${docsName} ${cardsName}`);

  const docs = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      topicId: documents.topicId,
      title: documents.title,
      description: documents.description,
      contentMd: documents.contentMd,
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
    })
    .from(cards);

  let cardOk = 0;
  let cardSkip = 0;
  let cardFail = 0;
  for (const [i, card] of cardRows.entries()) {
    if (indexedCardIds.has(card.id)) {
      cardSkip += 1;
    } else {
      try {
        await indexCard(card);
        cardOk += 1;
      } catch (err) {
        cardFail += 1;
        console.error(`card fail ${card.id}: ${failMessage(err)}`);
      }
    }
    if ((i + 1) % 50 === 0 || i + 1 === cardRows.length) {
      console.log(
        `cards ${String(i + 1)}/${String(cardRows.length)} ok=${String(cardOk)} skip=${String(cardSkip)} fail=${String(cardFail)}`,
      );
    }
  }

  console.log(
    JSON.stringify({
      documents: { total: docs.length, ok: docOk, fail: docFail },
      cards: { total: cardRows.length, ok: cardOk, skip: cardSkip, fail: cardFail },
      stores: { documents: docsName, cards: cardsName },
    }),
  );
  if (docFail > 0 || cardFail > 0) process.exitCode = 1;
} catch (err) {
  console.error('backfill failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
