import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { getUserById, issueAuthCookies } from './auth.service.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, readSignedCookie } from './cookies.js';
import { verifyToken } from './token.js';

async function userIdFromToken(
  token: string,
  type: 'access' | 'refresh',
): Promise<string | undefined> {
  try {
    const { userId } = verifyToken(token, type);
    await getUserById(userId);
    return userId;
  } catch {
    return undefined;
  }
}

/** Fastify decorator: require a valid access cookie (refresh cookie silently rotates it). */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const access = readSignedCookie(req, ACCESS_COOKIE_NAME);
  if (access) {
    const userId = await userIdFromToken(access, 'access');
    if (userId) {
      req.user = { id: userId };
      return;
    }
  }

  const refresh = readSignedCookie(req, REFRESH_COOKIE_NAME);
  if (refresh) {
    const userId = await userIdFromToken(refresh, 'refresh');
    if (userId) {
      issueAuthCookies(reply, userId);
      req.user = { id: userId };
      return;
    }
  }

  throw AppError.of(401, 'INVALID_TOKEN');
}

export function requireUser(req: FastifyRequest): { id: string } {
  const user = req.user;
  if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  return user;
}
