import type {
  AuthResponse,
  AvatarUploadUrlInput,
  AvatarUploadUrlResponse,
  ChangePasswordInput,
  ConfirmAvatarInput,
  UpdateProfileInput,
  User,
} from '@inwit/dto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authModeFromOrigin } from '../auth/auth-logic.js';
import { getUserById, issueAuthResponse, toPublicUser } from '../auth/auth.service.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { accessTokens, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import { presignPut } from '../storage/client.js';
import { avatarKeyFor, isAvatarKeyForUser, validateAvatarUpload } from '../storage/presign-logic.js';

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
  if (input.displayName === undefined && input.email === undefined) {
    return toPublicUser(await getUserById(userId));
  }

  const patch: { displayName?: string; email?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    const [taken] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, userId)))
      .limit(1);
    if (taken) throw AppError.of(409, 'EMAIL_TAKEN');
    patch.email = email;
  }

  try {
    const [row] = await getDb()
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();
    if (!row) throw AppError.of(401, 'INVALID_TOKEN');
    return toPublicUser(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolation(err)) throw AppError.of(409, 'EMAIL_TAKEN');
    throw err;
  }
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthResponse> {
  const current = await getUserById(userId);
  if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
    throw AppError.of(401, 'WRONG_PASSWORD');
  }
  const passwordHash = await hashPassword(input.newPassword);
  const row = await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw AppError.of(401, 'INVALID_TOKEN');
    await tx.delete(accessTokens).where(eq(accessTokens.userId, userId));
    return updated;
  });
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  return issueAuthResponse(reply, row, authModeFromOrigin(origin, config.WEB_ORIGIN));
}

export async function requestAvatarUpload(
  userId: string,
  input: AvatarUploadUrlInput,
): Promise<AvatarUploadUrlResponse> {
  await getUserById(userId);
  const { mime } = validateAvatarUpload(input.contentType, input.sizeBytes);
  const key = avatarKeyFor(userId, mime);
  const uploadUrl = await presignPut(key, mime);
  return { uploadUrl, key };
}

export async function confirmAvatar(userId: string, input: ConfirmAvatarInput): Promise<User> {
  if (!isAvatarKeyForUser(input.key, userId)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  const [row] = await getDb()
    .update(users)
    .set({ avatarKey: input.key, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw AppError.of(401, 'INVALID_TOKEN');
  return toPublicUser(row);
}
