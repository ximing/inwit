import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conceptEvidence, documents } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  documentHashOf,
  resolveConceptEvidence,
  snapshotConceptSource,
} from './concept-evidence.js';
import {
  findQuoteOccurrences,
  resolveQuoteLocation,
  validateEvidenceInBlocks,
} from './concept-evidence-logic.js';
import { createConcept } from './concept.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

describeDb('concept-evidence（真实 PG + 纯逻辑）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('正文 hash 不含标题：改标题不变，改正文变', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const docA = await seedDocument(db, userId, { title: '标题甲', blocks: ['同一正文。'] });
    const docB = await seedDocument(db, userId, { title: '完全不同的标题', blocks: ['同一正文。'] });

    const snapA = await snapshotConceptSource(userId, docA);
    const snapB = await snapshotConceptSource(userId, docB);
    expect(snapA.hash).toBe(snapB.hash);

    await db
      .update(documents)
      .set({
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '改过的正文。' }] }],
        },
      })
      .where(eq(documents.id, docA));
    const snapA2 = await snapshotConceptSource(userId, docA);
    expect(snapA2.hash).not.toBe(snapA.hash);
  });

  it('空文、未提取 PDF、超长文档分别给出可识别错误', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const emptyDoc = await seedDocument(db, userId, { title: '空文', blocks: [] });
    await expect(snapshotConceptSource(userId, emptyDoc)).rejects.toMatchObject({
      status: 422,
      code: 'CONCEPT_SOURCE_EMPTY',
    });

    const pdfDoc = await seedDocument(db, userId, {
      title: '未提取 PDF',
      blocks: [],
      fileKey: 'imports/x.pdf',
      fileMime: 'application/pdf',
    });
    await expect(snapshotConceptSource(userId, pdfDoc)).rejects.toMatchObject({
      status: 422,
      code: 'CONCEPT_SOURCE_NOT_EXTRACTED',
    });

    const longDoc = await seedDocument(db, userId, {
      title: '长文',
      blocks: ['长'.repeat(60_001)],
    });
    await expect(snapshotConceptSource(userId, longDoc)).rejects.toMatchObject({
      status: 422,
      code: 'CONCEPT_SOURCE_TOO_LONG',
    });

    // 恰好 60,000 字符可以通过
    const boundaryDoc = await seedDocument(db, userId, {
      title: '边界',
      blocks: ['长'.repeat(60_000)],
    });
    const snapshot = await snapshotConceptSource(userId, boundaryDoc);
    expect(snapshot.totalChars).toBe(60_000);
  });

  it('selection 范围截取对应块', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const docId = await seedDocument(db, userId, {
      blocks: ['第一段', '第二段', null, '第三段（第二页）'],
    });
    const snapshot = await snapshotConceptSource(userId, docId, 'selection', {
      fromBlockIndex: 2,
      toBlockIndex: 4,
    });
    expect(snapshot.blocks.map((block) => block.index)).toEqual([2, 3, 4]);
    expect(snapshot.blocks[2]!.pageIndex).toBe(2);
  });

  it('真实引文通过核验；虚构引文拒绝；重复引文无唯一上下文返回失效', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const docId = await seedDocument(db, userId, {
      blocks: ['Trial 是一次尝试。', '另一段。', 'Trial 是一次尝试。'],
    });
    const snapshot = await snapshotConceptSource(userId, docId);

    const ok = validateEvidenceInBlocks(snapshot.blocks, {
      kind: 'block',
      blockIndex: 1,
      quote: 'Trial 是一次尝试。',
      prefix: undefined,
      suffix: undefined,
    });
    expect(ok).toEqual({
      ok: true,
      occurrence: { blockIndex: 1, pageIndex: 1, start: 0, end: 'Trial 是一次尝试。'.length },
    });

    const fabricated = validateEvidenceInBlocks(snapshot.blocks, {
      kind: 'quote',
      quote: '模型编造的句子',
    });
    expect(fabricated).toEqual({ ok: false, reason: 'not_found' });

    // 同一引文出现在两个块：quote 定位不能取第一个
    const duplicated = validateEvidenceInBlocks(snapshot.blocks, {
      kind: 'quote',
      quote: 'Trial 是一次尝试。',
    });
    expect(duplicated).toEqual({ ok: false, reason: 'ambiguous' });

    // block 定位要求命中指定块
    const wrongBlock = validateEvidenceInBlocks(snapshot.blocks, {
      kind: 'block',
      blockIndex: 2,
      quote: 'Trial 是一次尝试。',
    });
    expect(wrongBlock.ok).toBe(false);

    // 同一块内重复时可用前后文消歧
    const repeatBlocks = (
      await snapshotConceptSource(
        userId,
        await seedDocument(db, userId, { blocks: ['苹果落地。苹果落地是因为引力。'] }),
      )
    ).blocks;
    const disambiguated = validateEvidenceInBlocks(repeatBlocks, {
      kind: 'block',
      blockIndex: 1,
      quote: '苹果落地',
      suffix: '是因为引力',
    });
    expect(disambiguated.ok).toBe(true);
    const stillAmbiguous = validateEvidenceInBlocks(repeatBlocks, {
      kind: 'block',
      blockIndex: 1,
      quote: '苹果落地',
    });
    expect(stillAmbiguous).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('resolve：正文其他部分变化仍唯一定位（hashChanged）；引文消失/多重则 stale', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docId = await seedDocument(db, userId, {
      title: '出处文档',
      blocks: ['Trial 是一次尝试。', '无关段落。'],
    });

    const created = await createConcept(userId, topicId, {
      name: 'Trial',
      aliases: [],
      evidence: [
        {
          documentId: docId,
          locator: { kind: 'block', blockIndex: 1, quote: 'Trial 是一次尝试。' },
          basis: 'explicit',
        },
      ],
    });
    const [evidenceRow] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, created.concept.id));
    expect(evidenceRow).toBeDefined();

    const resolved = await resolveConceptEvidence(userId, evidenceRow!.id);
    expect(resolved).toMatchObject({ status: 'resolved', blockIndex: 1, pageIndex: 1, hashChanged: false });

    // 修改无关段落：hash 变化但引文仍唯一 → resolved + hashChanged
    await db
      .update(documents)
      .set({
        contentJson: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Trial 是一次尝试。' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '无关段落已修改。' }] },
          ],
        },
      })
      .where(eq(documents.id, docId));
    const stillResolved = await resolveConceptEvidence(userId, evidenceRow!.id);
    expect(stillResolved).toMatchObject({ status: 'resolved', hashChanged: true });

    // 引文消失 → stale，保留摘录
    await db
      .update(documents)
      .set({
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '全新的内容。' }] }],
        },
      })
      .where(eq(documents.id, docId));
    const stale = await resolveConceptEvidence(userId, evidenceRow!.id);
    expect(stale.status).toBe('stale');
    if (stale.status === 'stale') {
      expect(stale.quote).toBe('Trial 是一次尝试。');
      expect(stale.documentTitleSnapshot).toBe('出处文档');
    }
  });

  it('来源软删除/硬删除后 unavailable；跨用户 evidenceId 返回 404', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const docId = await seedDocument(db, userId, { blocks: ['将被删除的文档。'] });

    const created = await createConcept(userId, topicId, {
      name: '概念X',
      aliases: [],
      evidence: [
        {
          documentId: docId,
          locator: { kind: 'quote', quote: '将被删除的文档。' },
          basis: 'explicit',
        },
      ],
    });
    const [evidenceRow] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.conceptId, created.concept.id));

    // 软删除 → unavailable
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, docId));
    const softDeleted = await resolveConceptEvidence(userId, evidenceRow!.id);
    expect(softDeleted.status).toBe('unavailable');
    const [afterSoft] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.id, evidenceRow!.id));
    expect(afterSoft!.availability).toBe('unavailable');
    expect(afterSoft!.quote).toBe('将被删除的文档。');

    // 硬删除 → documentId 置空，仍 unavailable，摘录保留
    await db.delete(documents).where(eq(documents.id, docId));
    const hardDeleted = await resolveConceptEvidence(userId, evidenceRow!.id);
    expect(hardDeleted.status).toBe('unavailable');
    const [afterHard] = await db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.id, evidenceRow!.id));
    expect(afterHard!.documentId).toBeNull();
    expect(afterHard!.quote).toBe('将被删除的文档。');

    // 跨用户 → 404
    await expect(resolveConceptEvidence(otherUser, evidenceRow!.id)).rejects.toMatchObject({
      status: 404,
      code: 'CONCEPT_EVIDENCE_NOT_FOUND',
    });
  });

  it('resolveQuoteLocation：首选块失效时要求全文唯一匹配', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const docId = await seedDocument(db, userId, {
      blocks: ['第一段', '目标句。', '第三段', '目标句。'],
    });
    const snapshot = await snapshotConceptSource(userId, docId);

    // 首选块仍命中
    const direct = resolveQuoteLocation(snapshot.blocks, {
      kind: 'block',
      blockIndex: 2,
      quote: '目标句。',
    });
    expect(direct).toEqual({ status: 'resolved', blockIndex: 2, pageIndex: 1 });

    // 首选块失效且全文多处 → stale，不取第一个
    const ambiguous = resolveQuoteLocation(snapshot.blocks, {
      kind: 'block',
      blockIndex: 1,
      quote: '目标句。',
    });
    expect(ambiguous).toEqual({ status: 'stale' });

    // 首选块失效但全文唯一 → 用唯一块
    const unique = resolveQuoteLocation(snapshot.blocks, {
      kind: 'block',
      blockIndex: 1,
      quote: '第三段',
    });
    expect(unique).toEqual({ status: 'resolved', blockIndex: 3, pageIndex: 1 });

    const occurrences = findQuoteOccurrences(snapshot.blocks, '目标句。');
    expect(occurrences.map((hit) => hit.blockIndex)).toEqual([2, 4]);
  });

  it('证据写入校验文档归属', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const otherUser = await seedUser(db);
    const topicId = await seedTopic(db, userId);
    const foreignDoc = await seedDocument(db, otherUser, { blocks: ['别人的文档。'] });

    await expect(
      createConcept(userId, topicId, {
        name: '越权证据',
        aliases: [],
        evidence: [
          {
            documentId: foreignDoc,
            locator: { kind: 'quote', quote: '别人的文档。' },
            basis: 'explicit',
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND' });

    // 越权失败不应留下概念
    const rows = await db
      .select()
      .from(conceptEvidence)
      .where(and(eq(conceptEvidence.userId, userId)));
    expect(rows).toHaveLength(0);
  });
});
