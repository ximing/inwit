import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, pool } from '../db/index.js';
import { cards, users } from '../db/schema.js';
import { deleteCard, indexCard, searchCards } from './pipeline.js';
import { cardsStoreName, ensureRetrievalStores } from './registry.js';
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

    await deleteCard(card.id);
    await getDb().delete(cards).where(eq(cards.id, card.id));
    pass('deleteCard removed indexes');

    const after = await searchCards(user.id, '梯度消失 sigmoid 反向传播', 5);
    console.log(`search after delete=${JSON.stringify(after)}`);
    if (after.includes(card.id)) fail('searchCards still returned deleted card');
    pass('searchCards no longer returns the deleted card');
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
