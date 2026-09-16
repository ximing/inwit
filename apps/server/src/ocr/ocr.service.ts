import type { OcrConfig, OcrTestResult, UpsertOcrConfigInput } from '@inwit/dto';
import { createCanvas } from '@napi-rs/canvas';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { ocrConfigs, type OcrConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { decryptSecret, encryptSecret, maskApiKey } from '../llm/crypto.js';
import { logLlmUsage } from '../llm/usage.js';
import { completeOcrPage } from './ocr-api.js';
import {
  OCR_DEFAULT_BASE_URL,
  OCR_DEFAULT_MODEL,
  pngToDataUrl,
  redactSecret,
} from './ocr-logic.js';

function toPublic(row: OcrConfigRow): OcrConfig {
  const plain = decryptSecret(row.apiKeyEncrypted);
  return {
    id: row.id,
    userId: row.userId,
    model: row.model,
    baseUrl: row.baseUrl,
    apiKeyPreview: plain ? maskApiKey(plain) : '****',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getRow(userId: string): Promise<OcrConfigRow | null> {
  const [row] = await getDb().select().from(ocrConfigs).where(eq(ocrConfigs.userId, userId)).limit(1);
  return row ?? null;
}

export interface ResolvedOcr {
  apiKey: string;
  model: string;
  baseUrl: string;
  source: 'user' | 'system';
}

/** User ocr_configs, then system DASHSCOPE_API_KEY. */
export async function resolveOcrFor(userId: string): Promise<ResolvedOcr> {
  const row = await getRow(userId);
  if (row) {
    const apiKey = decryptSecret(row.apiKeyEncrypted);
    if (apiKey) {
      return {
        apiKey,
        model: row.model.length > 0 ? row.model : OCR_DEFAULT_MODEL,
        baseUrl: row.baseUrl && row.baseUrl.length > 0 ? row.baseUrl : OCR_DEFAULT_BASE_URL,
        source: 'user',
      };
    }
  }
  if (!config.DASHSCOPE_API_KEY) throw AppError.of(400, 'LLM_NOT_CONFIGURED');
  return {
    apiKey: config.DASHSCOPE_API_KEY,
    model: OCR_DEFAULT_MODEL,
    baseUrl: OCR_DEFAULT_BASE_URL,
    source: 'system',
  };
}

export async function getOcrConfig(userId: string): Promise<OcrConfig | null> {
  const row = await getRow(userId);
  return row ? toPublic(row) : null;
}

export async function upsertOcrConfig(userId: string, input: UpsertOcrConfigInput): Promise<OcrConfig> {
  const existing = await getRow(userId);
  const now = new Date();

  if (!existing) {
    if (input.apiKey === undefined) throw AppError.of(400, 'VALIDATION_ERROR');
    const [created] = await getDb()
      .insert(ocrConfigs)
      .values({
        userId,
        apiKeyEncrypted: encryptSecret(input.apiKey),
        model: input.model,
        baseUrl: input.baseUrl ?? null,
      })
      .returning();
    if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
    return toPublic(created);
  }

  const [updated] = await getDb()
    .update(ocrConfigs)
    .set({
      ...(input.apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(input.apiKey) } : {}),
      model: input.model,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      updatedAt: now,
    })
    .where(and(eq(ocrConfigs.id, existing.id), eq(ocrConfigs.userId, userId)))
    .returning();
  if (!updated) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublic(updated);
}

function testImagePng(): Buffer {
  const canvas = createCanvas(240, 72);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 240, 72);
  ctx.fillStyle = '#111111';
  ctx.font = '28px sans-serif';
  ctx.fillText('Inwit OCR', 16, 46);
  return canvas.toBuffer('image/png');
}

export async function testOcrConfig(userId: string): Promise<OcrTestResult> {
  const resolved = await resolveOcrFor(userId);
  try {
    const result = await completeOcrPage({
      apiKey: resolved.apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      imageDataUrl: pngToDataUrl(testImagePng()),
      timeoutMs: 30_000,
    });
    await logLlmUsage({
      userId,
      provider: 'dashscope',
      model: resolved.model,
      capability: 'chat',
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSecret(message, resolved.apiKey) };
  }
}
