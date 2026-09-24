import { describe, expect, it } from 'vitest';
import { authModeFromOrigin, tokensForMode } from './auth-logic.js';

describe('authModeFromOrigin', () => {
  it('treats the configured web origin as cookie mode', () => {
    expect(authModeFromOrigin('http://localhost:5190', 'http://localhost:5190')).toBe('cookie');
    expect(authModeFromOrigin('https://inwit.aimo.plus', 'https://inwit.aimo.plus')).toBe('cookie');
  });

  it('treats missing or other origins as bearer (non-WEB_ORIGIN callers)', () => {
    expect(authModeFromOrigin(undefined, 'http://localhost:5190')).toBe('bearer');
    expect(authModeFromOrigin('http://localhost:5190', 'https://inwit.aimo.plus')).toBe('bearer');
    expect(authModeFromOrigin('tauri://localhost', 'http://localhost:5190')).toBe('bearer');
  });
});

describe('tokensForMode', () => {
  const issued = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresIn: 900,
  };

  it('omits tokens for cookie clients', () => {
    expect(tokensForMode('cookie', issued)).toBeUndefined();
  });

  it('returns access and refresh for bearer clients', () => {
    expect(tokensForMode('bearer', issued)).toEqual(issued);
  });
});
