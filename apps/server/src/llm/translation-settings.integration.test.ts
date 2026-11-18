import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import {
  documents,
  llmConfigs,
  llmCredentialVersions,
  pdfSegments,
  pdfTranslationJobs,
  jobs,
} from '../db/schema.js';
import {
  createLlmConfig,
  deleteLlmConfig,
  listLlmConfigs,
  updateLlmConfig,
} from './llm.service.js';
import {
  getTranslationSettings,
  saveTranslationSettings,
  deleteTranslationSettings,
  readTranslationCredential,
} from './translation-settings.service.js';
import { requestSegmentTranslation } from '../documents/translation/translation.service.js';
import { cancelPdfTranslationCarrier } from '../jobs/pdf-translation-lifecycle.js';
vi.mock('../net/public-url.js', async (original) => ({
  ...(await original<typeof import('../net/public-url.js')>()),
  assertOptionalPublicBaseUrl: vi.fn().mockResolvedValue(undefined),
}));
const ctx = isolatedDbContext();
describe.skipIf(!ctx.available)('translation settings real PostgreSQL isolation', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => teardownIsolatedDb(iso));
  async function task(userId: string) {
    const [doc] = await iso.db
      .insert(documents)
      .values({
        userId,
        source: 'import',
        fileKey: 'local/test.pdf',
        fileMime: 'application/pdf',
        fileRevision: 'a',
      })
      .returning();
    const segmentId = randomUUID();
    await iso.db
      .insert(pdfSegments)
      .values({
        id: segmentId,
        userId,
        documentId: doc!.id,
        fileRevision: 'a',
        parserVersion: 'test',
        pageIndex: 0,
        ordinal: 0,
        sourceText: 'Original text',
        textHash: 'hash',
        rects: [],
        qualityState: 'reliable',
      });
    return requestSegmentTranslation(userId, doc!.id, {
      segmentId,
      fileRevision: 'a',
      idempotencyKey: randomUUID(),
    });
  }
  it('first translation config is never a chat default and never listed in chat', async () => {
    const userId = await seedUser(iso.db);
    await saveTranslationSettings(userId, {
      provider: 'openai',
      model: 'translation-a',
      apiKey: 'only-translation',
    });
    expect(await listLlmConfigs(userId)).toEqual([]);
    const [row] = await iso.db.select().from(llmConfigs).where(eq(llmConfigs.userId, userId));
    expect(row).toMatchObject({ purpose: 'translation', isDefault: false });
    const chat = await createLlmConfig(userId, {
      provider: 'openai',
      model: 'chat-a',
      apiKey: 'chat-secret',
    });
    expect(chat.isDefault).toBe(true);
    expect((await getTranslationSettings(userId)).config?.model).toBe('translation-a');
  });
  it('copy is independent of source edits/deletion and returns no plaintext', async () => {
    const userId = await seedUser(iso.db);
    const source = await createLlmConfig(userId, {
      provider: 'openai',
      model: 'source-model',
      apiKey: 'source-secret',
    });
    const copied = await saveTranslationSettings(userId, { copyFromConfigId: source.id });
    expect(copied.config?.id).not.toBe(source.id);
    expect(JSON.stringify(copied)).not.toContain('source-secret');
    await updateLlmConfig(userId, source.id, { model: 'changed-chat', apiKey: 'new-chat-key' });
    expect((await getTranslationSettings(userId)).config?.model).toBe('source-model');
    await saveTranslationSettings(userId, { provider: 'openai', model: 'translation-edited' });
    expect((await listLlmConfigs(userId))[0]?.model).toBe('changed-chat');
    await deleteLlmConfig(userId, source.id);
    expect((await getTranslationSettings(userId)).config?.model).toBe('translation-edited');
  });
  it('rotation retains submitted credential only until the task reaches terminal', async () => {
    const userId = await seedUser(iso.db);
    await saveTranslationSettings(userId, { provider: 'openai', model: 'a', apiKey: 'old-key' });
    const response = await task(userId);
    const [submitted] = await iso.db
      .select()
      .from(pdfTranslationJobs)
      .where(eq(pdfTranslationJobs.id, response.job!.id));
    await saveTranslationSettings(userId, { provider: 'openai', model: 'b', apiKey: 'new-key' });
    expect(
      await iso.db.transaction((tx) =>
        readTranslationCredential(tx, userId, submitted!.credentialVersionId),
      ),
    ).toBe('old-key');
    expect(submitted?.modelSnapshot.model).toBe('a');
    const [carrier] = await iso.db.select().from(jobs).where(eq(jobs.id, submitted!.jobId));
    await cancelPdfTranslationCarrier(carrier!);
    const [old] = await iso.db
      .select()
      .from(llmCredentialVersions)
      .where(eq(llmCredentialVersions.id, submitted!.credentialVersionId));
    expect(old?.apiKeyEncrypted).toBeNull();
  });
  it('snapshot versus deletion completes without deadlock and revokes every old version', async () => {
    const userId = await seedUser(iso.db);
    await saveTranslationSettings(userId, { provider: 'openai', model: 'a', apiKey: 'key' });
    await Promise.allSettled([task(userId), deleteTranslationSettings(userId)]);
    expect((await getTranslationSettings(userId)).config).toBeNull();
    const versions = await iso.db
      .select()
      .from(llmCredentialVersions)
      .where(eq(llmCredentialVersions.userId, userId));
    expect(versions.every((v) => v.revokedAt && v.apiKeyEncrypted === null)).toBe(true);
  });
});
