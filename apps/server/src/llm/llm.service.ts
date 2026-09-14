import type { CreateLlmConfigInput, LlmConfig, LlmTestResult, UpdateLlmConfigInput } from '@inwit/dto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { llmConfigs, type LlmConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { decryptSecret, encryptSecret, maskApiKey } from './crypto.js';
import { completeChat } from './usage.js';
import { resolvedFromRow } from './pi.js';

function toPublic(row: LlmConfigRow): LlmConfig {
  const plain = decryptSecret(row.apiKeyEncrypted);
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    model: row.model,
    isDefault: row.isDefault,
    baseUrl: row.baseUrl,
    apiKeyPreview: plain ? maskApiKey(plain) : '****',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOwned(userId: string, id: string): Promise<LlmConfigRow> {
  const [row] = await getDb()
    .select()
    .from(llmConfigs)
    .where(and(eq(llmConfigs.id, id), eq(llmConfigs.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
  return row;
}

export async function listLlmConfigs(userId: string): Promise<LlmConfig[]> {
  const rows = await getDb()
    .select()
    .from(llmConfigs)
    .where(eq(llmConfigs.userId, userId))
    .orderBy(desc(llmConfigs.createdAt));
  return rows.map(toPublic);
}

export async function createLlmConfig(
  userId: string,
  input: CreateLlmConfigInput,
): Promise<LlmConfig> {
  const existing = await getDb()
    .select({ id: llmConfigs.id })
    .from(llmConfigs)
    .where(eq(llmConfigs.userId, userId));
  const isDefault = input.isDefault ?? existing.length === 0;
  const now = new Date();
  const row = await getDb().transaction(async (tx) => {
    if (isDefault) {
      await tx
        .update(llmConfigs)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)));
    }
    const [created] = await tx
      .insert(llmConfigs)
      .values({
        userId,
        provider: input.provider,
        apiKeyEncrypted: encryptSecret(input.apiKey),
        model: input.model,
        isDefault,
        baseUrl: input.baseUrl ?? null,
      })
      .returning();
    if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
    return created;
  });
  return toPublic(row);
}

export async function updateLlmConfig(
  userId: string,
  id: string,
  input: UpdateLlmConfigInput,
): Promise<LlmConfig> {
  const current = await getOwned(userId, id);
  const now = new Date();
  const [row] = await getDb()
    .update(llmConfigs)
    .set({
      ...(input.apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(input.apiKey) } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      updatedAt: now,
    })
    .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)))
    .returning();
  if (!row) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
  return toPublic(row);
}

export async function deleteLlmConfig(userId: string, id: string): Promise<void> {
  const current = await getOwned(userId, id);
  await getDb()
    .delete(llmConfigs)
    .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)));
}

export async function setDefaultLlmConfig(userId: string, id: string): Promise<LlmConfig> {
  const current = await getOwned(userId, id);
  const now = new Date();
  const row = await getDb().transaction(async (tx) => {
    await tx
      .update(llmConfigs)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)));
    const [updated] = await tx
      .update(llmConfigs)
      .set({ isDefault: true, updatedAt: now })
      .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)))
      .returning();
    if (!updated) throw AppError.of(404, 'LLM_PROVIDER_NOT_FOUND');
    return updated;
  });
  return toPublic(row);
}

function redact(message: string, apiKey: string): string {
  if (apiKey.length === 0) return message;
  return message.split(apiKey).join('***');
}

export async function testLlmConfig(userId: string, id: string): Promise<LlmTestResult> {
  const row = await getOwned(userId, id);
  const apiKey = decryptSecret(row.apiKeyEncrypted);
  if (!apiKey) return { ok: false, error: '密钥无法解密' };
  try {
    await completeChat(
      userId,
      {
        messages: [{ role: 'user', content: 'Reply with only: pong' }],
        timeoutMs: 30_000,
        maxTokens: 64,
      },
      { resolved: resolvedFromRow(row, apiKey) },
    );
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof AppError
        ? typeof err.details === 'string'
          ? err.details
          : err.message
        : err instanceof Error
          ? err.message
          : 'unknown error';
    return { ok: false, error: redact(message, apiKey) };
  }
}
