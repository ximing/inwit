import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_PREFIX = 'iwt_';
export const ACCESS_TOKEN_BYTES = 32;

export function generateAccessToken(entropy: Buffer = randomBytes(ACCESS_TOKEN_BYTES)): string {
  if (entropy.length !== ACCESS_TOKEN_BYTES) {
    throw new Error('access token entropy must be 32 bytes');
  }
  return `${ACCESS_TOKEN_PREFIX}${entropy.toString('base64url')}`;
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Distinguish personal access tokens from session JWTs. */
export function isPersonalAccessToken(token: string): boolean {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return false;
  const body = token.slice(ACCESS_TOKEN_PREFIX.length);
  return body.length >= 40 && /^[A-Za-z0-9_-]+$/.test(body);
}

export function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const trimmed = authorization.trim();
  if (!/^Bearer\s+/i.test(trimmed)) return undefined;
  const token = trimmed.replace(/^Bearer\s+/i, '').trim();
  return token.length > 0 ? token : undefined;
}

/** First 8 and last 4 characters, middle replaced with ***. */
export function previewAccessToken(token: string): string {
  if (token.length <= 14) return `${token.slice(0, Math.min(4, token.length))}***`;
  return `${token.slice(0, 8)}***${token.slice(-4)}`;
}

export const ACCESS_TOKEN_LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCESS_TOKEN_LOG_PATH_MAX = 512;

export function accessTokenLogCutoff(now = new Date()): Date {
  return new Date(now.getTime() - ACCESS_TOKEN_LOG_TTL_MS);
}

export function requestPathForLog(url: string): string {
  const q = url.indexOf('?');
  const path = (q === -1 ? url : url.slice(0, q)) || '/';
  if (path.length <= ACCESS_TOKEN_LOG_PATH_MAX) return path;
  return path.slice(0, ACCESS_TOKEN_LOG_PATH_MAX);
}
