import type { AuthMode, AuthResponse, LoginInput, RegisterInput, User } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { users, type UserRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { isStorageConfigured, presignGet } from '../storage/client.js';
import { tokensForMode } from './auth-logic.js';
import { setAccessCookie, setRefreshCookie } from './cookies.js';
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

export function issueAuthCookies(reply: FastifyReply, userId: string): void {
  setAccessCookie(reply, signAccessToken(userId));
  setRefreshCookie(reply, signRefreshToken(userId));
}

async function authResponse(row: UserRow, mode: AuthMode): Promise<AuthResponse> {
  const accessToken = signAccessToken(row.id);
  const refreshToken = signRefreshToken(row.id);
  return {
    user: await toPublicUser(row),
    tokens: tokensForMode(mode, {
      accessToken,
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    }),
  };
}

function issueForMode(reply: FastifyReply, userId: string, mode: AuthMode): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  if (mode === 'cookie') {
    setAccessCookie(reply, accessToken);
    setRefreshCookie(reply, refreshToken);
  }
  return { accessToken, refreshToken };
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
    const issued = issueForMode(reply, row.id, mode);
    return {
      user: await toPublicUser(row),
      tokens: tokensForMode(mode, { ...issued, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS }),
    };
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
  const issued = issueForMode(reply, row.id, mode);
  return {
    user: await toPublicUser(row),
    tokens: tokensForMode(mode, { ...issued, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS }),
  };
}

export async function refreshBearer(refreshToken: string): Promise<AuthResponse> {
  const { userId } = verifyToken(refreshToken, 'refresh');
  const row = await getUserById(userId);
  return authResponse(row, 'bearer');
}

export async function getMe(userId: string): Promise<User> {
  return toPublicUser(await getUserById(userId));
}
