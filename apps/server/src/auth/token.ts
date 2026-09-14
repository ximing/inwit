import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const ACCESS_TYPE = 'access';
const REFRESH_TYPE = 'refresh';

function signToken(userId: string, type: typeof ACCESS_TYPE | typeof REFRESH_TYPE, expiresIn: number): string {
  return jwt.sign({ sub: userId, type }, config.JWT_SECRET, { expiresIn });
}

export function signAccessToken(userId: string): string {
  return signToken(userId, ACCESS_TYPE, config.ACCESS_TOKEN_TTL_SECONDS);
}

export function signRefreshToken(userId: string): string {
  return signToken(userId, REFRESH_TYPE, config.REFRESH_TOKEN_TTL_DAYS * 86_400);
}

export function verifyToken(
  token: string,
  expectedType: typeof ACCESS_TYPE | typeof REFRESH_TYPE,
): { userId: string } {
  try {
    const payload: unknown = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload !== 'object' || payload === null) throw new Error('bad payload');
    const claims: Record<string, unknown> = { ...payload };
    const typeValue = claims['type'];
    const sub = claims['sub'];
    if (typeValue !== expectedType || typeof sub !== 'string') {
      throw new Error('bad payload');
    }
    return { userId: sub };
  } catch {
    throw AppError.of(401, 'INVALID_TOKEN');
  }
}
