import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  assertLoginRateLimit,
  assertRefreshRateLimit,
  assertRegisterRateLimit,
  resetAuthRateLimits,
} from './auth-rate-limit.js';

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function expectLimited(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(429);
    expect((err as AppError).code).toBe('RATE_LIMITED');
    return;
  }
  expect.fail('expected RATE_LIMITED');
}

describe('auth rate limits', () => {
  beforeEach(() => {
    resetAuthRateLimits();
  });

  it('allows 5 registrations per IP per hour, then resets the window', () => {
    for (let i = 0; i < 5; i += 1) assertRegisterRateLimit('203.0.113.1', 0);
    expectLimited(() => assertRegisterRateLimit('203.0.113.1', HOUR_MS - 1));
    assertRegisterRateLimit('203.0.113.2', 0);
    for (let i = 0; i < 5; i += 1) assertRegisterRateLimit('203.0.113.1', HOUR_MS);
    expectLimited(() => assertRegisterRateLimit('203.0.113.1', HOUR_MS));
  });

  it('caps login by IP and by normalized email on separate 15 minute windows', () => {
    for (let i = 0; i < 10; i += 1) assertLoginRateLimit('203.0.113.4', 'Reader@Example.com', 0);
    expectLimited(() => assertLoginRateLimit('203.0.113.4', ' reader@example.com ', 0));
    assertLoginRateLimit('203.0.113.4', 'other@example.com', 0);
    assertLoginRateLimit('203.0.113.4', 'reader@example.com', FIFTEEN_MIN_MS);

    resetAuthRateLimits();
    for (let i = 0; i < 20; i += 1) {
      assertLoginRateLimit('203.0.113.5', `user${String(i)}@example.com`, 0);
    }
    expectLimited(() => assertLoginRateLimit('203.0.113.5', 'fresh@example.com', FIFTEEN_MIN_MS - 1));
    assertLoginRateLimit('203.0.113.6', 'fresh@example.com', 0);
    assertLoginRateLimit('203.0.113.5', 'fresh@example.com', FIFTEEN_MIN_MS);
  });

  it('allows 30 refreshes per IP per 15 minutes', () => {
    for (let i = 0; i < 30; i += 1) assertRefreshRateLimit('203.0.113.7', 0);
    expectLimited(() => assertRefreshRateLimit('203.0.113.7', 0));
    assertRefreshRateLimit('203.0.113.8', 0);
    assertRefreshRateLimit('203.0.113.7', FIFTEEN_MIN_MS);
  });

  it('does not share counters across register, login, and refresh', () => {
    for (let i = 0; i < 5; i += 1) assertRegisterRateLimit('203.0.113.9', 0);
    expectLimited(() => assertRegisterRateLimit('203.0.113.9', 0));
    assertLoginRateLimit('203.0.113.9', 'reader@example.com', 0);
    assertRefreshRateLimit('203.0.113.9', 0);
  });
});
