import type {
  AccessToken,
  AccessTokenLog,
  AccessTokenSecret,
  CreateAccessTokenInput,
  ListAccessTokenLogsQuery,
  Paginated,
} from '@inwit/dto';
import { ACCESS_TOKEN_MAX_PER_USER } from '@inwit/dto';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { accessTokenLogs, accessTokens, type AccessTokenRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { decryptSecret, encryptSecret } from '../llm/crypto.js';
import {
  accessTokenLogCutoff,
  generateAccessToken,
  hashAccessToken,
  previewAccessToken,
  requestPathForLog,
} from './access-token-logic.js';

export async function findAccessTokenByHash(
  hash: string,
): Promise<{ userId: string; tokenId: string } | undefined> {
  const [row] = await getDb()
    .select({ userId: accessTokens.userId, tokenId: accessTokens.id })
    .from(accessTokens)
    .where(eq(accessTokens.tokenHash, hash))
    .limit(1);
  if (!row) return undefined;
  return { userId: row.userId, tokenId: row.tokenId };
}

function toPublic(row: AccessTokenRow): AccessToken {
  let preview = row.tokenPreview;
  if (preview.length === 0) {
    const plain = decryptSecret(row.tokenEncrypted);
    preview = plain ? previewAccessToken(plain) : 'iwt_***';
  }
  return {
    id: row.id,
    name: row.name,
    preview,
    createdAt: row.createdAt.toISOString(),
  };
}

async function getOwnedAccessToken(userId: string, id: string): Promise<AccessTokenRow> {
  const [row] = await getDb()
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'ACCESS_TOKEN_NOT_FOUND');
  return row;
}

export async function listAccessTokens(userId: string): Promise<AccessToken[]> {
  const rows = await getDb()
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt));
  return rows.map(toPublic);
}

export async function createAccessToken(
  userId: string,
  input: CreateAccessTokenInput,
): Promise<AccessToken> {
  const existing = await getDb()
    .select({ id: accessTokens.id })
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId));
  if (existing.length >= ACCESS_TOKEN_MAX_PER_USER) {
    throw AppError.of(400, 'ACCESS_TOKEN_LIMIT');
  }

  const token = generateAccessToken();
  const [row] = await getDb()
    .insert(accessTokens)
    .values({
      userId,
      name: input.name,
      tokenHash: hashAccessToken(token),
      tokenEncrypted: encryptSecret(token),
      tokenPreview: previewAccessToken(token),
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublic(row);
}

export async function revealAccessToken(userId: string, id: string): Promise<AccessTokenSecret> {
  const row = await getOwnedAccessToken(userId, id);
  const token = decryptSecret(row.tokenEncrypted);
  if (!token) throw AppError.of(404, 'ACCESS_TOKEN_NOT_FOUND');
  return { token };
}

export async function listAccessTokenLogs(
  userId: string,
  query: ListAccessTokenLogsQuery,
): Promise<Paginated<AccessTokenLog>> {
  const cutoff = accessTokenLogCutoff();
  const filters = [eq(accessTokenLogs.userId, userId), gte(accessTokenLogs.createdAt, cutoff)];
  if (query.accessTokenId) {
    filters.push(eq(accessTokenLogs.accessTokenId, query.accessTokenId));
  }
  const where = and(...filters);

  const [totalRow] = await getDb()
    .select({ total: count() })
    .from(accessTokenLogs)
    .where(where);
  const rows = await getDb()
    .select({
      id: accessTokenLogs.id,
      accessTokenId: accessTokenLogs.accessTokenId,
      tokenName: accessTokens.name,
      method: accessTokenLogs.method,
      path: accessTokenLogs.path,
      status: accessTokenLogs.status,
      createdAt: accessTokenLogs.createdAt,
    })
    .from(accessTokenLogs)
    .innerJoin(accessTokens, eq(accessTokenLogs.accessTokenId, accessTokens.id))
    .where(where)
    .orderBy(desc(accessTokenLogs.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return {
    items: rows.map((row) => ({
      id: row.id,
      accessTokenId: row.accessTokenId,
      tokenName: row.tokenName,
      method: row.method,
      path: row.path,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    total: Number(totalRow?.total ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function recordAccessTokenCall(input: {
  userId: string;
  accessTokenId: string;
  method: string;
  path: string;
  status: number;
}): Promise<void> {
  const db = getDb();
  const cutoff = accessTokenLogCutoff();
  await db.insert(accessTokenLogs).values({
    userId: input.userId,
    accessTokenId: input.accessTokenId,
    method: input.method.slice(0, 16),
    path: requestPathForLog(input.path),
    status: input.status,
  });
  await db
    .delete(accessTokenLogs)
    .where(and(eq(accessTokenLogs.userId, input.userId), lt(accessTokenLogs.createdAt, cutoff)));
}

export async function pruneAccessTokenLogs(now = new Date()): Promise<void> {
  await getDb()
    .delete(accessTokenLogs)
    .where(lt(accessTokenLogs.createdAt, accessTokenLogCutoff(now)));
}

export function registerAccessTokenLogHook(app: FastifyInstance): void {
  app.addHook('onResponse', (req, reply, done) => {
    const userId = req.user?.id;
    const accessTokenId = req.user?.accessTokenId;
    if (!userId || !accessTokenId) {
      done();
      return;
    }
    void recordAccessTokenCall({
      userId,
      accessTokenId,
      method: req.method,
      path: req.url,
      status: reply.statusCode,
    }).catch((err: unknown) => {
      req.log.warn({ err }, 'access_token_log_failed');
    });
    done();
  });
}
