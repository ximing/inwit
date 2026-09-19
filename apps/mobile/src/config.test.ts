import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
  resolveApiBaseUrl,
} from './config-logic';

describe('resolveApiBaseUrl', () => {
  it('prefers the env URL over extra and fallback', () => {
    expect(
      resolveApiBaseUrl('https://inwit.aimo.plus/', 'http://localhost:3020', DEFAULT_API_BASE_URL),
    ).toBe(DEFAULT_PROD_API_BASE_URL);
  });

  it('uses extra when env is empty', () => {
    expect(resolveApiBaseUrl('  ', 'http://192.168.1.12:3020/', DEFAULT_API_BASE_URL)).toBe(
      'http://192.168.1.12:3020',
    );
  });

  it('falls back to the local API', () => {
    expect(resolveApiBaseUrl(undefined, undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('', null)).toBe(DEFAULT_API_BASE_URL);
  });
});
