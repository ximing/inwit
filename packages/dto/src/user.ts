import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/** Public user — password hash never leaves the server. */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(255),
  displayName: z.string().max(64).nullable(),
  /** Presigned GET URL issued by the server; never a stored object URL. */
  avatarUrl: z.string().url().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const registerInputSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = registerInputSchema;
export type LoginInput = z.infer<typeof loginInputSchema>;

export const authModeSchema = z.enum(['cookie', 'bearer']);
export type AuthMode = z.infer<typeof authModeSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  tokens: authTokensSchema.optional(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const updateProfileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  email: z.string().email().max(255).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const avatarUploadUrlInputSchema = z.object({
  contentType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive().max(AVATAR_MAX_BYTES),
});
export type AvatarUploadUrlInput = z.infer<typeof avatarUploadUrlInputSchema>;

export const avatarUploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string().min(1).max(255),
});
export type AvatarUploadUrlResponse = z.infer<typeof avatarUploadUrlResponseSchema>;

export const confirmAvatarInputSchema = z.object({
  key: z.string().min(1).max(255),
});
export type ConfirmAvatarInput = z.infer<typeof confirmAvatarInputSchema>;

export const ACCESS_TOKEN_NAME_MAX = 64;
export const ACCESS_TOKEN_MAX_PER_USER = 20;

export const createAccessTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(ACCESS_TOKEN_NAME_MAX),
});
export type CreateAccessTokenInput = z.infer<typeof createAccessTokenInputSchema>;

/** Public token row — preview only, never the secret. */
export const accessTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preview: z.string(),
  createdAt: z.string(),
});
export type AccessToken = z.infer<typeof accessTokenSchema>;

export const accessTokenSecretSchema = z.object({
  token: z.string().min(1),
});
export type AccessTokenSecret = z.infer<typeof accessTokenSecretSchema>;

export const accessTokenLogSchema = z.object({
  id: z.string().uuid(),
  accessTokenId: z.string().uuid(),
  tokenName: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  createdAt: z.string(),
});
export type AccessTokenLog = z.infer<typeof accessTokenLogSchema>;

export const listAccessTokenLogsQuerySchema = paginationQuerySchema.extend({
  accessTokenId: z.string().uuid().optional(),
});
export type ListAccessTokenLogsQuery = z.infer<typeof listAccessTokenLogsQuerySchema>;
