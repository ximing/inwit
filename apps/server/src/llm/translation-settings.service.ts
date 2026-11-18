import {
  PROVIDER_BASE_URLS,
  type TranslationModelSnapshot,
  type TranslationSettings,
  type UpdateTranslationSettings,
} from '@inwit/dto';
import { and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  llmConfigs,
  llmCredentialVersions,
  userTranslationSettings,
  pdfTranslationJobs,
  users,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { SAVED_ENDPOINT_CODES, assertOptionalPublicBaseUrl } from '../net/public-url.js';
import { decryptSecret, encryptSecret } from './crypto.js';
export type TranslationTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function getTranslationSettings(userId: string): Promise<TranslationSettings> {
  const [row] = await getDb()
    .select({ config: llmConfigs })
    .from(userTranslationSettings)
    .leftJoin(
      llmConfigs,
      and(
        eq(llmConfigs.id, userTranslationSettings.llmConfigId),
        eq(llmConfigs.userId, userId),
        eq(llmConfigs.purpose, 'translation'),
      ),
    )
    .where(eq(userTranslationSettings.userId, userId));
  const c = row?.config;
  return {
    targetLanguage: 'zh-CN',
    config: c
      ? {
          id: c.id,
          userId: c.userId,
          provider: c.provider,
          model: c.model,
          isDefault: false,
          baseUrl: c.baseUrl,
          apiKeyPreview: '已保存',
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        }
      : null,
  };
}
export async function saveTranslationSettings(
  userId: string,
  input: UpdateTranslationSettings,
): Promise<TranslationSettings> {
  if (!('copyFromConfigId' in input))
    await assertOptionalPublicBaseUrl(input.baseUrl, SAVED_ENDPOINT_CODES);
  await getDb().transaction(async (tx) => {
    // Serialize first creation, rotation and deletion, including absence of a settings row.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [binding] = await tx
      .select()
      .from(userTranslationSettings)
      .where(eq(userTranslationSettings.userId, userId));
    const [current] = binding?.llmConfigId
      ? await tx
          .select()
          .from(llmConfigs)
          .where(
            and(
              eq(llmConfigs.id, binding.llmConfigId),
              eq(llmConfigs.userId, userId),
              eq(llmConfigs.purpose, 'translation'),
            ),
          )
      : [];
    let provider, model, baseUrl, encrypted;
    if ('copyFromConfigId' in input) {
      const [source] = await tx
        .select()
        .from(llmConfigs)
        .where(
          and(
            eq(llmConfigs.id, input.copyFromConfigId),
            eq(llmConfigs.userId, userId),
            eq(llmConfigs.purpose, 'chat'),
          ),
        )
        .for('share');
      if (!source) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
      ({ provider, model, baseUrl } = source);
      encrypted = source.apiKeyEncrypted;
    } else {
      ({ provider, model } = input);
      baseUrl = input.baseUrl ?? null;
      encrypted = input.apiKey ? encryptSecret(input.apiKey) : current?.apiKeyEncrypted;
    }
    if (!encrypted) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
    const now = new Date();
    const [config] = current
      ? await tx
          .update(llmConfigs)
          .set({ provider, model, baseUrl, apiKeyEncrypted: encrypted, updatedAt: now })
          .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)))
          .returning()
      : await tx
          .insert(llmConfigs)
          .values({
            userId,
            provider,
            model,
            baseUrl,
            apiKeyEncrypted: encrypted,
            purpose: 'translation',
            isDefault: false,
          })
          .returning();
    if (!config) throw AppError.of(500, 'INTERNAL_ERROR');
    const [version] = await tx
      .insert(llmCredentialVersions)
      .values({ userId, configId: config.id, apiKeyEncrypted: encrypted })
      .returning();
    if (!version) throw AppError.of(500, 'INTERNAL_ERROR');
    await tx
      .insert(userTranslationSettings)
      .values({ userId, llmConfigId: config.id, credentialVersionId: version.id })
      .onConflictDoUpdate({
        target: userTranslationSettings.userId,
        set: { llmConfigId: config.id, credentialVersionId: version.id, updatedAt: now },
      });
  });
  await cleanupTranslationCredentials(userId);
  return getTranslationSettings(userId);
}
export async function deleteTranslationSettings(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [binding] = await tx
      .select()
      .from(userTranslationSettings)
      .where(eq(userTranslationSettings.userId, userId));
    if (!binding?.llmConfigId) return;
    // The same credential row is locked by dispatch. Revocation cannot race past its gate.
    await tx
      .update(llmCredentialVersions)
      .set({ revokedAt: new Date(), apiKeyEncrypted: null })
      .where(
        and(
          eq(llmCredentialVersions.userId, userId),
          eq(llmCredentialVersions.configId, binding.llmConfigId),
        ),
      );
    await tx
      .update(userTranslationSettings)
      .set({ llmConfigId: null, credentialVersionId: null, updatedAt: new Date() })
      .where(eq(userTranslationSettings.userId, userId));
    await tx
      .delete(llmConfigs)
      .where(
        and(
          eq(llmConfigs.id, binding.llmConfigId),
          eq(llmConfigs.userId, userId),
          eq(llmConfigs.purpose, 'translation'),
        ),
      );
  });
}
export async function snapshotTranslationModel(
  tx: TranslationTx,
  userId: string,
): Promise<TranslationModelSnapshot> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('share');
  const [s] = await tx
    .select()
    .from(userTranslationSettings)
    .where(eq(userTranslationSettings.userId, userId))
    .for('share');
  if (!s?.llmConfigId || !s.credentialVersionId) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  const [c] = await tx
    .select()
    .from(llmConfigs)
    .where(
      and(
        eq(llmConfigs.id, s.llmConfigId),
        eq(llmConfigs.userId, userId),
        eq(llmConfigs.purpose, 'translation'),
      ),
    )
    .for('share');
  if (!c) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  await readTranslationCredential(tx, userId, s.credentialVersionId);
  return {
    provider: c.provider,
    model: c.model,
    baseUrl: c.baseUrl || PROVIDER_BASE_URLS[c.provider],
    configId: c.id,
    credentialVersionId: s.credentialVersionId,
  };
}
export async function readTranslationCredential(
  tx: TranslationTx,
  userId: string,
  versionId: string,
): Promise<string> {
  const [v] = await tx
    .select()
    .from(llmCredentialVersions)
    .where(and(eq(llmCredentialVersions.id, versionId), eq(llmCredentialVersions.userId, userId)))
    .for('share');
  const key = v && !v.revokedAt && v.apiKeyEncrypted ? decryptSecret(v.apiKeyEncrypted) : null;
  if (!key) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  return key;
}
export async function cleanupTranslationCredentials(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await tx
      .update(llmCredentialVersions)
      .set({ apiKeyEncrypted: null })
      .where(
        and(
          eq(llmCredentialVersions.userId, userId),
          isNull(llmCredentialVersions.revokedAt),
          notExists(
            getDb()
              .select({ id: userTranslationSettings.userId })
              .from(userTranslationSettings)
              .where(eq(userTranslationSettings.credentialVersionId, llmCredentialVersions.id)),
          ),
          notExists(
            getDb()
              .select({ id: pdfTranslationJobs.id })
              .from(pdfTranslationJobs)
              .where(
                and(
                  eq(pdfTranslationJobs.credentialVersionId, llmCredentialVersions.id),
                  inArray(pdfTranslationJobs.state, ['queued', 'preparing', 'dispatched']),
                ),
              ),
          ),
        ),
      );
  });
}
