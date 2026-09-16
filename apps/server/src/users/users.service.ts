import type {
  AvatarUploadUrlInput,
  AvatarUploadUrlResponse,
  ConfirmAvatarInput,
  UpdateProfileInput,
  User,
} from '@inwit/dto';
import { and, eq, ne } from 'drizzle-orm';
import { getUserById, toPublicUser } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { users } from '../db/schema.js';
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
