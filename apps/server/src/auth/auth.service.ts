import type { AuthMode, AuthResponse, LoginInput, RegisterInput, User } from '@inwit/dto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { users, type UserRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { isStorageConfigured, presignGet } from '../storage/client.js';
import { tokensForMode } from './auth-logic.js';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  readSignedCookie,
  setAccessCookie,
  setRefreshCookie,
} from './cookies.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccessToken, signRefreshToken, verifyToken } from './token.js';

async function avatarUrlFor(key: string | null): Promise<string | null> {
  if (!key || !isStorageConfigured()) return null;
  try {
    return await presignGet(key);
  } catch {
    // Login / me must not fail if signing is unavailable.
    return null;
  }
}

export async function toPublicUser(row: UserRow): Promise<User> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName ?? null,
    avatarUrl: await avatarUrlFor(row.avatarKey ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getUserById(userId: string): Promise<UserRow> {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw AppError.of(401, 'INVALID_TOKEN');
  return row;
}

function signPair(userId: string, sessionVersion: number): { accessToken: string; refreshToken: string } {
  return {
    accessToken: signAccessToken(userId, sessionVersion),
    refreshToken: signRefreshToken(userId, sessionVersion),
  };
}

export function issueAuthCookies(reply: FastifyReply, userId: string, sessionVersion: number): void {
  const issued = signPair(userId, sessionVersion);
  setAccessCookie(reply, issued.accessToken);
  setRefreshCookie(reply, issued.refreshToken);
}

async function authResponse(row: UserRow, mode: AuthMode): Promise<AuthResponse> {
  const issued = signPair(row.id, row.sessionVersion);
  return {
    user: await toPublicUser(row),
    tokens: tokensForMode(mode, { ...issued, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS }),
  };
}

export function issueAuthForMode(
  reply: FastifyReply,
  userId: string,
  sessionVersion: number,
  mode: AuthMode,
): { accessToken: string; refreshToken: string } {
  const issued = signPair(userId, sessionVersion);
  if (mode === 'cookie') {
    setAccessCookie(reply, issued.accessToken);
    setRefreshCookie(reply, issued.refreshToken);
  }
  return issued;
}

export async function issueAuthResponse(
  reply: FastifyReply,
  row: UserRow,
  mode: AuthMode,
): Promise<AuthResponse> {
  const issued = issueAuthForMode(reply, row.id, row.sessionVersion, mode);
  return {
    user: await toPublicUser(row),
    tokens: tokensForMode(mode, { ...issued, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS }),
  };
}

export async function registerUser(
  input: RegisterInput,
  reply: FastifyReply,
  mode: AuthMode,
): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  try {
    const [row] = await getDb()
      .insert(users)
      .values({ email, passwordHash })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    return issueAuthResponse(reply, row, mode);
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.of(409, 'EMAIL_ALREADY_REGISTERED');
    throw err;
  }
}

export async function loginUser(
  input: LoginInput,
  reply: FastifyReply,
  mode: AuthMode,
): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const [row] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
    throw AppError.of(401, 'INVALID_CREDENTIALS');
  }
  return issueAuthResponse(reply, row, mode);
}

export async function refreshBearer(refreshToken: string): Promise<AuthResponse> {
  const { userId, sessionVersion } = verifyToken(refreshToken, 'refresh');
  const row = await getUserById(userId);
  if (row.sessionVersion !== sessionVersion) throw AppError.of(401, 'INVALID_TOKEN');
  return authResponse(row, 'bearer');
}

/** Bump sessionVersion when the presented cookie still matches. Never throws. */
export async function logoutSession(req: FastifyRequest): Promise<void> {
  try {
    const refresh = readSignedCookie(req, REFRESH_COOKIE_NAME);
    const token = refresh ?? readSignedCookie(req, ACCESS_COOKIE_NAME);
    if (!token) return;
    const kind = refresh ? 'refresh' : 'access';
    const { userId, sessionVersion } = verifyToken(token, kind);
    await getDb()
      .update(users)
      .set({
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, userId), eq(users.sessionVersion, sessionVersion)));
  } catch {
    // Unreadable or already-stale credentials still count as logged out.
  }
}

export async function getMe(userId: string): Promise<User> {
  return toPublicUser(await getUserById(userId));
}
