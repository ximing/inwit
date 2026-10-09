import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';

const secrets = vi.hoisted(() => ({
  jwt: 'jwt-secret-jwt-secret-jwt-secret-32',
  cookie: 'cookie-secret-cookie-secret-cookie-32',
  llm: 'ab'.repeat(32),
}));

type Row = Record<string, unknown>;

const mem = vi.hoisted(() => {
  const users: Row[] = [];
  const tokens: Row[] = [];
  let current: () => unknown = () => {
    throw new Error('db not ready');
  };
  return {
    users,
    tokens,
    setDb(fn: () => unknown) {
      current = fn;
    },
    getDb() {
      return current();
    },
    reset() {
      users.length = 0;
      tokens.length = 0;
    },
  };
});

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_SECRET: secrets.jwt,
    COOKIE_SECRET: secrets.cookie,
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
    WEB_ORIGIN: 'http://localhost:5190',
    LLM_KEY_ENCRYPTION_KEY: secrets.llm,
  },
}));

vi.mock('../db/index.js', () => ({
  getDb: () => mem.getDb(),
  setDb: () => undefined,
}));

import { encryptSecret } from '../llm/crypto.js';
import { deleteAccessToken, revealAccessToken } from './access-tokens.js';
import { generateAccessToken } from './access-token-logic.js';
import { registerAuthRoutes } from './auth.routes.js';
import { authenticate } from './authenticate.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './cookies.js';
import { hashPassword } from './password.js';
import { signAccessToken, signRefreshToken } from './token.js';
import { registerUserRoutes } from '../users/users.routes.js';
import { accessTokens, users } from '../db/schema.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'correct-horse';
const NEW_PASSWORD = 'new-password';
const WEB_ORIGIN = 'http://localhost:5190';

function createMemoryDb(state: { users: Row[]; tokens: Row[] }) {
  const keyOf = new Map<object, string>();
  const lists = new Map<object, Row[]>([
    [users, state.users],
    [accessTokens, state.tokens],
  ]);
  for (const table of [users, accessTokens]) {
    for (const [key, value] of Object.entries(table)) {
      if (value && typeof value === 'object') keyOf.set(value, key);
    }
  }

  function flatten(node: unknown, out: unknown[] = []): unknown[] {
    if (node == null || typeof node === 'string') {
      if (typeof node === 'string') out.push(node);
      return out;
    }
    if (typeof node !== 'object') {
      out.push(node);
      return out;
    }
    if (keyOf.has(node)) {
      out.push(node);
      return out;
    }
    const obj = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(obj.queryChunks)) {
      for (const chunk of obj.queryChunks) flatten(chunk, out);
      return out;
    }
    if (Array.isArray(obj.value) && obj.value.every((part) => typeof part === 'string')) {
      out.push(obj.value.join(''));
      return out;
    }
    out.push(node);
    return out;
  }

  function describeTokens(tokens: unknown[]): string {
    return tokens
      .map((token) => {
        if (typeof token === 'string') return JSON.stringify(token);
        if (token && typeof token === 'object' && 'name' in token) {
          return `col:${String((token as { name: unknown }).name)}`;
        }
        return typeof token;
      })
      .join(' | ');
  }

  function matches(row: Row, condition: unknown): boolean {
    const tokens = flatten(condition);
    const comps: Array<{ key: string; value: unknown }> = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token || typeof token !== 'object' || !keyOf.has(token)) continue;
      const op = tokens[i + 1];
      const raw = tokens[i + 2];
      if (typeof op !== 'string' || !op.includes('=')) continue;
      const key = keyOf.get(token);
      if (!key || !raw || typeof raw !== 'object' || !('value' in raw)) continue;
      comps.push({ key, value: (raw as { value: unknown }).value });
    }
    if (comps.length === 0) throw new Error(`unparsed where: ${describeTokens(tokens)}`);
    return comps.every((cmp) => row[cmp.key] === cmp.value);
  }

  function rowsOf(table: object): Row[] {
    const list = lists.get(table);
    if (!list) throw new Error('unexpected table');
    return list;
  }

  function evalAssigned(row: Row, value: unknown): unknown {
    if (!value || typeof value !== 'object' || !('queryChunks' in value)) return value;
    const tokens = flatten(value);
    const col = tokens.find((token) => token !== null && typeof token === 'object' && keyOf.has(token));
    const text = tokens.filter((token) => typeof token === 'string').join('');
    if (col && /\+\s*1/.test(text)) {
      const key = keyOf.get(col);
      return Number(key ? row[key] : 0) + 1;
    }
    throw new Error(`unparsed assignment: ${describeTokens(tokens)}`);
  }

  function applyUpdate(table: object, values: Record<string, unknown>, condition: unknown): Row[] {
    const updated: Row[] = [];
    for (const row of rowsOf(table)) {
      if (!matches(row, condition)) continue;
      const next: Row = {};
      for (const [key, value] of Object.entries(values)) next[key] = evalAssigned(row, value);
      Object.assign(row, next);
      updated.push({ ...row });
    }
    return updated;
  }

  function applyDelete(table: object, condition: unknown): Row[] {
    const list = rowsOf(table);
    const removed: Row[] = [];
    const kept: Row[] = [];
    for (const row of list) {
      if (matches(row, condition)) removed.push({ ...row });
      else kept.push(row);
    }
    list.length = 0;
    list.push(...kept);
    return removed;
  }

  function thenable<T>(value: T, extra: Record<string, unknown> = {}) {
    const promise = Promise.resolve(value);
    return {
      ...extra,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
  }

  const db: {
    select(): unknown;
    update(table: object): unknown;
    delete(table: object): unknown;
    transaction(fn: (tx: object) => Promise<unknown>): Promise<unknown>;
  } = {
    select() {
      return {
        from(table: object) {
          return {
            where(condition: unknown) {
              const found = rowsOf(table)
                .filter((row) => matches(row, condition))
                .map((row) => ({ ...row }));
              return thenable(found, {
                limit(n: number) {
                  return Promise.resolve(found.slice(0, n));
                },
              });
            },
          };
        },
      };
    },
    update(table: object) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              const updated = applyUpdate(table, values, condition);
              return thenable(undefined, {
                returning() {
                  return Promise.resolve(updated);
                },
              });
            },
          };
        },
      };
    },
    delete(table: object) {
      return {
        where(condition: unknown) {
          const removed = applyDelete(table, condition);
          return thenable(removed, {
            returning() {
              return Promise.resolve(removed);
            },
          });
        },
      };
    },
    transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}

function cookieHeader(app: FastifyInstance, pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}=${encodeURIComponent(app.signCookie(value))}`)
    .join('; ');
}

function setCookieHeader(headers: { 'set-cookie'?: string | string[] | undefined }): string {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list
    .map((item) => item.split(';')[0] ?? '')
    .filter((item) => item.length > 0)
    .join('; ');
}

describe('session version', () => {
  let app: FastifyInstance;
  let passwordHash = '';

  beforeAll(async () => {
    mem.setDb(() => createMemoryDb(mem));
    passwordHash = await hashPassword(PASSWORD);
    app = Fastify({ logger: false });
    await app.register(cookie, { secret: secrets.cookie });
    app.decorate('authenticate', authenticate);
    registerErrorHandler(app);
    registerAuthRoutes(app);
    registerUserRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mem.reset();
    mem.users.push({
      id: USER_ID,
      email: 'reader@example.com',
      passwordHash,
      displayName: null,
      avatarKey: null,
      reviewSettings: null,
      sessionVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  function seedToken(): string {
    const plain = generateAccessToken();
    mem.tokens.push({
      id: TOKEN_ID,
      userId: USER_ID,
      name: '脚本',
      tokenHash: 'hash',
      tokenEncrypted: encryptSecret(plain),
      tokenPreview: 'iwt_abcd***WXYZ',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    return plain;
  }

  function accessCookie(sessionVersion: number): string {
    return cookieHeader(app, { [ACCESS_COOKIE_NAME]: signAccessToken(USER_ID, sessionVersion) });
  }

  it('rejects reveal with 404 after the token is revoked', async () => {
    const plain = seedToken();
    const cookie = accessCookie(0);
    const before = await app.inject({
      method: 'POST',
      url: `/api/me/access-tokens/${TOKEN_ID}/reveal`,
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ token: plain });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/me/access-tokens/${TOKEN_ID}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: `/api/me/access-tokens/${TOKEN_ID}/reveal`,
      headers: { cookie },
    });
    expect(after.statusCode).toBe(404);
    expect(after.json().error.code).toBe('ACCESS_TOKEN_NOT_FOUND');
    await expect(revealAccessToken(USER_ID, TOKEN_ID)).rejects.toMatchObject({
      status: 404,
      code: 'ACCESS_TOKEN_NOT_FOUND',
    });
    await expect(deleteAccessToken(USER_ID, TOKEN_ID)).rejects.toMatchObject({
      status: 404,
      code: 'ACCESS_TOKEN_NOT_FOUND',
    });
  });

  it('keeps the current browser logged in and rejects the previous access cookie', async () => {
    seedToken();
    const oldCookie = accessCookie(0);
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: oldCookie } });
    expect(before.statusCode).toBe(200);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: { cookie: oldCookie, origin: WEB_ORIGIN },
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().tokens).toBeUndefined();
    expect(mem.users[0]?.sessionVersion).toBe(1);
    expect(mem.tokens).toHaveLength(0);

    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: oldCookie },
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: setCookieHeader(changed.headers) },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().email).toBe('reader@example.com');
  });

  it('returns new bearer tokens and rejects the old access token', async () => {
    const oldAccess = signAccessToken(USER_ID, 0);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: { authorization: `Bearer ${oldAccess}` },
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(200);
    const tokens = changed.json().tokens as { accessToken: string; refreshToken: string };
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));

    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${oldAccess}` },
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('does not rotate the session when the current password is wrong', async () => {
    const cookie = accessCookie(0);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: { cookie, origin: WEB_ORIGIN },
      payload: { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('WRONG_PASSWORD');
    expect(res.json().error.message).toBe('当前密码不正确');
    expect(mem.users[0]?.sessionVersion).toBe(0);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('refuses to exchange a refresh cookie after logout', async () => {
    const refresh = signRefreshToken(USER_ID, 0);
    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: cookieHeader(app, {
          [ACCESS_COOKIE_NAME]: signAccessToken(USER_ID, 0),
          [REFRESH_COOKIE_NAME]: refresh,
        }),
      },
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(mem.users[0]?.sessionVersion).toBe(1);

    const silent = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeader(app, { [REFRESH_COOKIE_NAME]: refresh }) },
    });
    expect(silent.statusCode).toBe(401);

    const exchanged = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh },
    });
    expect(exchanged.statusCode).toBe(401);
    expect(exchanged.json().error.code).toBe('INVALID_TOKEN');
  });

  it('does not bump a newer session when logout replays a stale refresh cookie', async () => {
    const staleRefresh = signRefreshToken(USER_ID, 0);
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieHeader(app, { [REFRESH_COOKIE_NAME]: staleRefresh }) },
    });
    expect(mem.users[0]?.sessionVersion).toBe(1);

    const current = cookieHeader(app, {
      [ACCESS_COOKIE_NAME]: signAccessToken(USER_ID, 1),
      [REFRESH_COOKIE_NAME]: signRefreshToken(USER_ID, 1),
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieHeader(app, { [REFRESH_COOKIE_NAME]: staleRefresh }) },
    });
    expect(replay.statusCode).toBe(204);
    expect(mem.users[0]?.sessionVersion).toBe(1);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: current } });
    expect(me.statusCode).toBe(200);
  });
});
