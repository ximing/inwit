import type { FastifyReply } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ISSUER = 'https://super-agent-auth.aimo.plus/realms/super-agent-test';
const secrets = vi.hoisted(() => ({
  jwt: 'jwt-secret-jwt-secret-jwt-secret-32',
  cookie: 'cookie-secret-cookie-secret-cookie-32',
}));

const cfg = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  WEB_ORIGIN: 'http://localhost:5190',
  JWT_SECRET: secrets.jwt,
  COOKIE_SECRET: secrets.cookie,
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  OIDC_ISSUER: undefined as string | undefined,
  OIDC_CLIENT_ID: undefined as string | undefined,
  OIDC_CLIENT_SECRET: undefined as string | undefined,
  OIDC_REDIRECT_URI: undefined as string | undefined,
  OIDC_AUDIENCE: undefined as string | undefined,
  OIDC_ADMIN_USER: undefined as string | undefined,
  OIDC_ADMIN_PASSWORD: undefined as string | undefined,
}));

const box = vi.hoisted(() => ({
  existing: false,
  calls: [] as string[],
}));

vi.mock('../config.js', () => ({ config: cfg }));

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => {
  const state = {
    users: [] as Row[],
    identities: [] as Row[],
    db: (() => {
      throw new Error('db not ready');
    }) as () => unknown,
  };
  return state;
});

vi.mock('../db/index.js', () => ({
  getDb: () => mem.db(),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    box.calls.push(`${init?.method ?? 'GET'} ${target}`);
    if (target.endsWith('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'admin-token', expires_in: 300 }), { status: 200 });
    }
    if (target.includes('/users?')) {
      return new Response(JSON.stringify(box.existing ? [{ id: 'kc-existing' }] : []), { status: 200 });
    }
    if ((init?.method ?? 'GET') === 'POST' && target.endsWith('/users')) {
      return new Response(null, {
        status: 201,
        headers: { location: `${ISSUER.replace('/realms/super-agent-test', '')}/admin/realms/super-agent-test/users/kc-new` },
      });
    }
    return new Response(null, { status: 204 });
  }),
);

import { users, oidcIdentities } from '../db/schema.js';
import { registerUser } from './auth.service.js';
import { resetOidcCaches } from './oidc.service.js';

function rowsOf(table: object): Row[] {
  if (table === users) return mem.users;
  if (table === oidcIdentities) return mem.identities;
  throw new Error('unexpected table');
}

function memoryDb() {
  return {
    select() {
      return {
        from(table: object) {
          const pending = {
            where() {
              return pending;
            },
            limit() {
              return Promise.resolve(rowsOf(table).map((row) => ({ ...row })));
            },
          };
          return pending;
        },
      };
    },
    insert(table: object) {
      return {
        values(value: Row) {
          const row = {
            id: `id-${rowsOf(table).length + 1}`,
            sessionVersion: 0,
            displayName: null,
            avatarKey: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            ...value,
          };
          rowsOf(table).push(row);
          return { returning: () => Promise.resolve([{ ...row }]) };
        },
      };
    },
    delete(table: object) {
      return {
        where() {
          rowsOf(table).splice(0, rowsOf(table).length);
          return Promise.resolve();
        },
      };
    },
  };
}

const reply = { setCookie() {}, clearCookie() {} } as unknown as FastifyReply;

function enable(): void {
  cfg.OIDC_ISSUER = ISSUER;
  cfg.OIDC_CLIENT_ID = 'inwit';
  cfg.OIDC_CLIENT_SECRET = '1234567890abcdef';
  cfg.OIDC_REDIRECT_URI = 'http://localhost:5190/api/auth/oidc/callback';
  cfg.OIDC_AUDIENCE = 'inwit-api';
  cfg.OIDC_ADMIN_USER = 'admin';
  cfg.OIDC_ADMIN_PASSWORD = 'admin-secret-value';
}

describe('registration copies the account into Keycloak', () => {
  beforeEach(() => {
    cfg.OIDC_ISSUER = undefined;
    cfg.OIDC_CLIENT_ID = undefined;
    cfg.OIDC_CLIENT_SECRET = undefined;
    cfg.OIDC_REDIRECT_URI = undefined;
    cfg.OIDC_AUDIENCE = undefined;
    cfg.OIDC_ADMIN_USER = undefined;
    cfg.OIDC_ADMIN_PASSWORD = undefined;
    box.existing = false;
    box.calls = [];
    mem.users = [];
    mem.identities = [];
    mem.db = () => memoryDb();
    resetOidcCaches();
  });

  it('keeps the current registration when OIDC is off', async () => {
    const response = await registerUser(
      { email: 'Ada@Example.com', password: 'correct-horse' },
      reply,
      'bearer',
    );
    expect(response.user.email).toBe('ada@example.com');
    expect(mem.identities).toHaveLength(0);
    expect(box.calls).toHaveLength(0);
  });

  it('refuses an email that already exists in Keycloak', async () => {
    enable();
    box.existing = true;
    await expect(
      registerUser({ email: 'ada@example.com', password: 'correct-horse' }, reply, 'bearer'),
    ).rejects.toMatchObject({ status: 409, code: 'OIDC_EMAIL_EXISTS' });
    expect(mem.users).toHaveLength(0);
    expect(box.calls.some((call) => call.startsWith('POST') && call.endsWith('/users'))).toBe(false);
  });

  it('creates the Keycloak user and the identity row', async () => {
    enable();
    const response = await registerUser(
      { email: 'ada@example.com', password: 'correct-horse' },
      reply,
      'bearer',
    );
    expect(response.user.email).toBe('ada@example.com');
    expect(mem.identities).toEqual([
      expect.objectContaining({ userId: 'id-1', issuer: ISSUER, sub: 'kc-new' }),
    ]);
    expect(box.calls.some((call) => call.startsWith('POST') && call.includes('/users'))).toBe(true);
  });
});
