import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';

const secrets = vi.hoisted(() => ({
  jwt: 'jwt-secret-jwt-secret-jwt-secret-32',
}));

vi.mock('../config.js', () => ({
  config: {
    JWT_SECRET: secrets.jwt,
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
  },
}));

import { signAccessToken, signRefreshToken, verifyToken } from './token.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function expectInvalid(token: string, type: 'access' | 'refresh'): void {
  try {
    verifyToken(token, type);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(401);
    expect((err as AppError).code).toBe('INVALID_TOKEN');
    return;
  }
  expect.fail('expected INVALID_TOKEN');
}

describe('session version claim', () => {
  it('round-trips sv on access and refresh tokens', () => {
    expect(verifyToken(signAccessToken(USER_ID, 0), 'access')).toEqual({
      userId: USER_ID,
      sessionVersion: 0,
    });
    expect(verifyToken(signRefreshToken(USER_ID, 4), 'refresh')).toEqual({
      userId: USER_ID,
      sessionVersion: 4,
    });
  });

  it('rejects tokens whose sv is missing or not an integer', () => {
    expectInvalid(jwt.sign({ sub: USER_ID, type: 'access' }, secrets.jwt, { expiresIn: 60 }), 'access');
    expectInvalid(
      jwt.sign({ sub: USER_ID, type: 'access', sv: '1' }, secrets.jwt, { expiresIn: 60 }),
      'access',
    );
    expectInvalid(
      jwt.sign({ sub: USER_ID, type: 'access', sv: 1.5 }, secrets.jwt, { expiresIn: 60 }),
      'access',
    );
    expectInvalid(
      jwt.sign({ sub: USER_ID, type: 'access', sv: -1 }, secrets.jwt, { expiresIn: 60 }),
      'access',
    );
    expectInvalid(signAccessToken(USER_ID, 1), 'refresh');
  });
});
