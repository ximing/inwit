import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const ACCESS_TYPE = 'access';
const REFRESH_TYPE = 'refresh';

function signToken(
  userId: string,
  sessionVersion: number,
  type: typeof ACCESS_TYPE | typeof REFRESH_TYPE,
  expiresIn: number,
): string {
  return jwt.sign({ sub: userId, type, sv: sessionVersion }, config.JWT_SECRET, { expiresIn });
}

export function signAccessToken(userId: string, sessionVersion: number): string {
  return signToken(userId, sessionVersion, ACCESS_TYPE, config.ACCESS_TOKEN_TTL_SECONDS);
}

export function signRefreshToken(userId: string, sessionVersion: number): string {
  return signToken(userId, sessionVersion, REFRESH_TYPE, config.REFRESH_TOKEN_TTL_DAYS * 86_400);
}

function readSessionVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('bad payload');
  }
  return value;
}

export function verifyToken(
  token: string,
  expectedType: typeof ACCESS_TYPE | typeof REFRESH_TYPE,
): { userId: string; sessionVersion: number } {
  try {
    const payload: unknown = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload !== 'object' || payload === null) throw new Error('bad payload');
    const claims: Record<string, unknown> = { ...payload };
    const typeValue = claims['type'];
    const sub = claims['sub'];
    if (typeValue !== expectedType || typeof sub !== 'string') {
      throw new Error('bad payload');
    }
    return { userId: sub, sessionVersion: readSessionVersion(claims['sv']) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.of(401, 'INVALID_TOKEN');
  }
}
