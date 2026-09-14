import { z } from 'zod';

/** Public user — password hash never leaves the server. */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(255),
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

export const authResponseSchema = z.object({
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
