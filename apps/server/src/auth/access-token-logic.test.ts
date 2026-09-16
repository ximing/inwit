import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_BYTES,
  ACCESS_TOKEN_PREFIX,
  accessTokenLogCutoff,
  generateAccessToken,
  hashAccessToken,
  isPersonalAccessToken,
  previewAccessToken,
  readBearerToken,
  requestPathForLog,
} from './access-token-logic.js';

describe('generateAccessToken', () => {
  it('prefixes iwt_ and encodes 32 bytes as base64url', () => {
    const entropy = Buffer.alloc(ACCESS_TOKEN_BYTES, 7);
    const token = generateAccessToken(entropy);
    expect(token).toBe(`${ACCESS_TOKEN_PREFIX}${entropy.toString('base64url')}`);
    expect(isPersonalAccessToken(token)).toBe(true);
  });

  it('rejects entropy of the wrong length', () => {
    expect(() => generateAccessToken(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('hashAccessToken', () => {
  it('returns stable sha256 hex', () => {
    const token = 'iwt_example';
    expect(hashAccessToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashAccessToken(token)).toHaveLength(64);
  });
});

describe('isPersonalAccessToken', () => {
  it('rejects JWTs and short or dotted values', () => {
    expect(isPersonalAccessToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig')).toBe(false);
    expect(isPersonalAccessToken('iwt_short')).toBe(false);
    expect(isPersonalAccessToken(`${ACCESS_TOKEN_PREFIX}${'a'.repeat(40)}.x`)).toBe(false);
  });
});

describe('readBearerToken', () => {
  it('reads Bearer tokens case-insensitively and ignores empties', () => {
    expect(readBearerToken('Bearer abc')).toBe('abc');
    expect(readBearerToken('bearer  xyz  ')).toBe('xyz');
    expect(readBearerToken('Basic abc')).toBeUndefined();
    expect(readBearerToken('Bearer')).toBeUndefined();
    expect(readBearerToken(undefined)).toBeUndefined();
  });
});

describe('previewAccessToken', () => {
  it('keeps the first 8 and last 4 characters', () => {
    const token = generateAccessToken(Buffer.alloc(ACCESS_TOKEN_BYTES, 7));
    expect(previewAccessToken(token)).toBe(`${token.slice(0, 8)}***${token.slice(-4)}`);
    expect(previewAccessToken(token)).not.toBe(token);
  });

  it('short values only keep a prefix', () => {
    expect(previewAccessToken('iwt_short')).toBe('iwt_***');
  });
});

describe('requestPathForLog', () => {
  it('strips the query string and caps length', () => {
    expect(requestPathForLog('/api/topics?x=1')).toBe('/api/topics');
    expect(requestPathForLog('/api/me')).toBe('/api/me');
    expect(requestPathForLog(`/${'a'.repeat(600)}`).length).toBe(512);
  });
});

describe('accessTokenLogCutoff', () => {
  it('is seven days before now', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    expect(accessTokenLogCutoff(now).toISOString()).toBe('2026-09-09T00:00:00.000Z');
  });
});
