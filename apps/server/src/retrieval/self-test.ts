import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';
import { config } from '../config.js';
import { getDb, pool } from '../db/index.js';
import { annotations, cards, documents, users } from '../db/schema.js';
import {
  deleteAnnotationFromIndex,
  deleteCardFromIndex,
  indexAnnotation,
  indexCard,
  searchAnnotations,
  searchCards,
} from './pipeline.js';
import { annotationsStoreName, cardsStoreName, ensureRetrievalStores, getRetrievalClients } from './registry.js';
import { rrfMerge } from './rrf.js';

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS  ${message}`);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

async function runSearchCli(): Promise<void> {
  const userId = argValue('--user-id');
  const query = argValue('--query') ?? '梯度';
  const limit = Number(argValue('--limit') ?? '10');
  if (!userId) fail('--search requires --user-id');
  await ensureRetrievalStores();
  const ids = await searchCards(userId, query, Number.isFinite(limit) ? limit : 10);
  console.log(JSON.stringify({ userId, query, ids, store: cardsStoreName() }));
  if (ids.length === 0) fail(`searchCards returned no hits for query=${query}`);
  pass(`searchCards returned ${String(ids.length)} hit(s)`);
}

async function runPipeline(): Promise<void> {
  const merged = rrfMerge([
    ['a', 'b', 'c'],
    ['b', 'a', 'd'],
  ]);
  if (merged[0] !== 'b' && merged[0] !== 'a') fail(`rrfMerge unexpected head: ${merged.join(',')}`);
  pass(`rrfMerge fused lists head=${merged[0] ?? ''}`);

  await ensureRetrievalStores();
  pass(`stores ready ${cardsStoreName()} dim=${String(config.EMBEDDING_DIMENSIONS)}`);

  const email = `t5-retrieval-${String(Date.now())}@inwit.local`;
  const [user] = await getDb()
    .insert(users)
    .values({ email, passwordHash: 't5-retrieval-placeholder' })
    .returning();
  if (!user) fail('failed to insert test user');

  const cardId = randomUUID();
  const concept = '梯度消失是深层网络反向传播时浅层梯度趋近于零的现象';
  const example = '很多层 sigmoid 连乘，导数小于 1，靠近输入的层几乎不再更新';
  const confusionPoint = '不要和梯度爆炸混淆：爆炸是连乘大于 1 导致更新过大';
  const tags = ['深度学习', '反向传播', '梯度消失'];

  try {
    const [card] = await getDb()
      .insert(cards)
      .values({
        id: cardId,
        userId: user.id,
        concept,
        example,
        confusionPoint,
        tags,
        source: 'manual',
      })
      .returning();
    if (!card) fail('failed to insert test card');

    await indexCard({
      id: card.id,
      userId: card.userId,
      concept: card.concept,
      example: card.example,
      confusionPoint: card.confusionPoint,
      tags: card.tags,
    });
    pass('indexCard upserted qdrant + meili');

    const hits = await searchCards(user.id, '梯度消失 sigmoid 反向传播', 5);
    console.log(`search hits=${JSON.stringify(hits)}`);
    if (!hits.includes(card.id)) fail('searchCards did not recall the indexed card');
    pass('searchCards recalled the indexed card');

    await deleteCardFromIndex(card.id);
    await getDb().delete(cards).where(eq(cards.id, card.id));
    pass('deleteCardFromIndex removed indexes');

    const after = await searchCards(user.id, '梯度消失 sigmoid 反向传播', 5);
    console.log(`search after delete=${JSON.stringify(after)}`);
    if (after.includes(card.id)) fail('searchCards still returned deleted card');
    pass('searchCards no longer returns the deleted card');

    // --- annotation segment ---
    const [doc] = await getDb()
      .insert(documents)
      .values({ userId: user.id, title: '自测文档', source: 'editor', status: 'digested' })
      .returning();
    if (!doc) fail('failed to insert test document');

    const [noteAnnotation] = await getDb()
      .insert(annotations)
      .values({
        userId: user.id,
        documentId: doc.id,
        quote: '反向传播时梯度逐层衰减',
        note: '这里讲的是梯度消失的根本原因，和sigmoid导数上限有关',
        kind: 'text',
      })
      .returning();
    if (!noteAnnotation) fail('failed to insert note annotation');

    await indexAnnotation({
      id: noteAnnotation.id,
      userId: noteAnnotation.userId,
      documentId: noteAnnotation.documentId,
      kind: noteAnnotation.kind,
      quote: noteAnnotation.quote,
      note: noteAnnotation.note,
    });
    pass('indexAnnotation upserted qdrant + meili');

    const annHits = await searchAnnotations(user.id, '梯度消失的原因 sigmoid', 5);
    console.log(`annotation hits=${JSON.stringify(annHits)}`);
    if (!annHits.includes(noteAnnotation.id)) {
      fail('searchAnnotations did not recall the indexed annotation');
    }
    pass('searchAnnotations recalled the indexed annotation');

    // Meili-only branch: empty note + placeholder quote skips Qdrant entirely.
    const [excerptAnnotation] = await getDb()
      .insert(annotations)
      .values({
        userId: user.id,
        documentId: doc.id,
        quote: IMAGE_EXCERPT_QUOTE,
        note: '',
        kind: 'pdf',
      })
      .returning();
    if (!excerptAnnotation) fail('failed to insert excerpt annotation');

    await indexAnnotation({
      id: excerptAnnotation.id,
      userId: excerptAnnotation.userId,
      documentId: excerptAnnotation.documentId,
      kind: excerptAnnotation.kind,
      quote: excerptAnnotation.quote,
      note: excerptAnnotation.note,
    });
    const { qdrant } = getRetrievalClients();
    const orphan = await qdrant.queryPoints(
      annotationsStoreName(),
      new Array<number>(config.EMBEDDING_DIMENSIONS).fill(0),
      { must: [{ key: 'user_id', match: { value: user.id } }] },
      50,
    );
    if (orphan.some((point) => String(point.payload.annotation_id ?? '') === excerptAnnotation.id)) {
      fail('placeholder excerpt annotation should not have a Qdrant point');
    }
    pass('placeholder excerpt annotation stayed out of qdrant (meili-only)');

    await deleteAnnotationFromIndex(noteAnnotation.id);
    await deleteAnnotationFromIndex(excerptAnnotation.id);
    const annAfter = await searchAnnotations(user.id, '梯度消失的原因 sigmoid', 5);
    console.log(`annotation search after delete=${JSON.stringify(annAfter)}`);
    if (annAfter.includes(noteAnnotation.id)) {
      fail('searchAnnotations still returned deleted annotation');
    }
    pass('searchAnnotations no longer returns the deleted annotation');
  } finally {
    await getDb().delete(users).where(eq(users.id, user.id));
  }
}

try {
  if (process.argv.includes('--search')) {
    await runSearchCli();
  } else {
    console.log('== T5 retrieval self-test ==');
    await runPipeline();
    console.log('all retrieval checks passed');
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
