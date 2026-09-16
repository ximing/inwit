import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import type { AuthPrincipal } from '../types.js';
import {
  hashAccessToken,
  isPersonalAccessToken,
  readBearerToken,
} from './access-token-logic.js';
import { findAccessTokenByHash } from './access-tokens.js';
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

async function principalFromBearer(token: string): Promise<AuthPrincipal | undefined> {
  if (isPersonalAccessToken(token)) {
    const found = await findAccessTokenByHash(hashAccessToken(token));
    if (!found) return undefined;
    return { id: found.userId, accessTokenId: found.tokenId };
  }
  const userId = await userIdFromToken(token, 'access');
  return userId ? { id: userId } : undefined;
}

/** Fastify decorator: Bearer PAT / JWT, else access cookie (refresh cookie silently rotates it). */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const bearer = readBearerToken(req.headers.authorization);
  if (bearer) {
    const principal = await principalFromBearer(bearer);
    if (principal) {
      req.user = principal;
      return;
    }
    throw AppError.of(401, 'INVALID_TOKEN');
  }

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

export function requireUser(req: FastifyRequest): AuthPrincipal {
  const user = req.user;
  if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  return user;
}
