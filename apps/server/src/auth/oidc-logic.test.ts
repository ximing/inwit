import { describe, expect, it } from 'vitest';
import { hashPassword } from './password.js';
import {
  allowedAlgs,
  audienceIncludes,
  decideEmail,
  displayNameFromClaims,
  idTokenAccepts,
  keycloakPasswordCredential,
  redactOidcUrl,
  registrationNames,
  resolveOidcConfig,
  sanitizeReturnTo,
  stateMatches,
  syntheticEmail,
  type OidcEnv,
} from './oidc-logic.js';

const base: OidcEnv = {
  NODE_ENV: 'development',
  WEB_ORIGIN: 'http://localhost:5190',
};

const ready: OidcEnv = {
  ...base,
  OIDC_ISSUER: 'https://super-agent-auth.aimo.plus/realms/super-agent-test',
  OIDC_CLIENT_ID: 'inwit',
  OIDC_CLIENT_SECRET: '1234567890abcdef',
  OIDC_REDIRECT_URI: 'http://localhost:5190/api/auth/oidc/callback',
  OIDC_AUDIENCE: 'inwit-api',
};

describe('resolveOidcConfig', () => {
  it('stays off without treating an empty config as an error', () => {
    expect(resolveOidcConfig(base)).toEqual({ enabled: false, error: false, missing: [] });
  });

  it('names the missing variables when only the issuer is set', () => {
    const resolved = resolveOidcConfig({ ...base, OIDC_ISSUER: ready.OIDC_ISSUER });
    expect(resolved.enabled).toBe(false);
    if (resolved.enabled) return;
    expect(resolved.error).toBe(true);
    expect(resolved.missing).toEqual(
      expect.arrayContaining(['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_AUDIENCE']),
    );
  });

  it('rejects a scope list that drops profile or asks for offline access', () => {
    for (const scopes of ['openid email', 'openid profile email offline_access']) {
      const resolved = resolveOidcConfig({ ...ready, OIDC_SCOPES: scopes });
      expect(resolved.enabled).toBe(false);
      if (resolved.enabled) continue;
      expect(resolved.missing).toContain('OIDC_SCOPES');
    }
  });

  it('rejects the shared client, the other audience, a foreign redirect, and http', () => {
    expect(resolveOidcConfig({ ...ready, OIDC_CLIENT_ID: 'super-agent-native' }).enabled).toBe(false);
    expect(resolveOidcConfig({ ...ready, OIDC_AUDIENCE: 'super-agent-api' }).enabled).toBe(false);
    expect(
      resolveOidcConfig({ ...ready, OIDC_REDIRECT_URI: 'https://evil.example/api/auth/oidc/callback' }).enabled,
    ).toBe(false);
    expect(
      resolveOidcConfig({
        ...ready,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'http://localhost:5190',
        OIDC_REDIRECT_URI: 'http://localhost:5190/api/auth/oidc/callback',
      }).enabled,
    ).toBe(false);
    expect(resolveOidcConfig({ ...ready, OIDC_ISSUER: 'http://super-agent-auth.aimo.plus/realms/super-agent-test' }).enabled).toBe(false);
  });

  it('enables a complete local config', () => {
    const resolved = resolveOidcConfig(ready);
    expect(resolved.enabled).toBe(true);
    if (!resolved.enabled) return;
    expect(resolved.config.scopes).toBe('openid profile email');
    expect(resolved.config.issuerHost).toBe('super-agent-auth.aimo.plus');
  });
});

describe('oidc pure helpers', () => {
  it('keeps an in-app return path and drops open redirects', () => {
    expect(sanitizeReturnTo('/docs?doc=1', base.WEB_ORIGIN)).toBe('/docs?doc=1');
    expect(sanitizeReturnTo('//evil', base.WEB_ORIGIN)).toBe('/');
    expect(sanitizeReturnTo('https://evil', base.WEB_ORIGIN)).toBe('/');
    expect(sanitizeReturnTo('/api/auth/oidc/callback', base.WEB_ORIGIN)).toBe('/');
  });

  it('builds a stable synthetic mailbox from the issuer', () => {
    const email = syntheticEmail('https://issuer.example/realms/a', 'sub-1');
    expect(email.length).toBeLessThan(255);
    expect(email.endsWith('@users.inwit.invalid')).toBe(true);
    expect(email).not.toContain('person@example.com');
    expect(syntheticEmail('https://issuer.example/realms/a', 'sub-1')).toBe(email);
    expect(syntheticEmail('https://issuer.example/realms/b', 'sub-1')).not.toBe(email);
  });

  it('prefers name and cuts the 65th code point', () => {
    expect(displayNameFromClaims(' Ada ', 'bob')).toBe('Ada');
    expect(displayNameFromClaims('   ', '  bob ')).toBe('bob');
    expect(displayNameFromClaims(' ', ' ')).toBeNull();
    expect(displayNameFromClaims('名'.repeat(65), '')).toBe('名'.repeat(64));
  });

  it('keeps only published asymmetric algorithms', () => {
    expect(allowedAlgs(['RS256', 'none', 'HS256'])).toEqual(['RS256']);
    expect(allowedAlgs(undefined)).toEqual(['RS256']);
    expect(allowedAlgs(['HS256'])).toEqual([]);
  });

  it('accepts this system audience only', () => {
    expect(audienceIncludes('inwit-api', 'inwit-api')).toBe(true);
    expect(audienceIncludes(['account', 'inwit-api'], 'inwit-api')).toBe(true);
    expect(audienceIncludes('super-agent-api', 'inwit-api')).toBe(false);
    expect(audienceIncludes('inwit', 'inwit-api')).toBe(false);
    expect(audienceIncludes(undefined, 'inwit-api')).toBe(false);
  });

  it('checks the id token audience, nonce, and subject', () => {
    const ok = {
      aud: 'inwit',
      clientId: 'inwit',
      nonce: 'n',
      expectedNonce: 'n',
      sub: 'person',
      accessSub: 'person',
    };
    expect(idTokenAccepts(ok)).toBeNull();
    expect(idTokenAccepts({ ...ok, aud: 'inwit-api' })).toBe('OIDC_AUDIENCE');
    expect(idTokenAccepts({ ...ok, nonce: 'other' })).toBe('OIDC_STATE');
    expect(idTokenAccepts({ ...ok, sub: 'someone-else' })).toBe('OIDC_SUBJECT');
  });

  it('does not turn an email collision into a link', () => {
    expect(decideEmail('', false)).toEqual({ kind: 'synthetic' });
    expect(decideEmail('not-an-email', false)).toEqual({ kind: 'invalid' });
    expect(decideEmail('Ada@Example.com', true)).toEqual({ kind: 'conflict' });
    expect(decideEmail('Ada@Example.com', false)).toEqual({ kind: 'use', email: 'ada@example.com' });
    expect(decideEmail('Ada@Example.com', true)).not.toHaveProperty('linkToUserId');
  });

  it('redacts callback secrets and leaves other urls alone', () => {
    const redacted = redactOidcUrl(
      '/api/auth/oidc/callback?code=SECRETCODE&state=SECRETSTATE&session_state=SECRETSESSION',
    );
    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('SECRETCODE');
    expect(redacted).not.toContain('SECRETSTATE');
    expect(redacted).not.toContain('SECRETSESSION');
    expect(redactOidcUrl('/api/auth/oidc/complete?login_code=SECRETLOGIN')).not.toContain('SECRETLOGIN');
    expect(redactOidcUrl('/api/auth/login?code=keep')).toBe('/api/auth/login?code=keep');
  });

  it('rejects a state whose byte length differs without throwing', () => {
    expect(stateMatches('abcd', 'abc')).toBe(false);
    expect(stateMatches('abcd', 'abcd')).toBe(true);
  });

  it('turns a registration hash into a Keycloak argon2 credential', async () => {
    const credential = keycloakPasswordCredential(await hashPassword('correct-horse'));
    expect(credential).not.toBeNull();
    const data = JSON.parse(credential!.credentialData) as {
      algorithm: string;
      hashIterations: number;
      additionalParameters: { type: string[]; version: string[]; memory: string[] };
    };
    expect(data.algorithm).toBe('argon2');
    expect(data.hashIterations).toBe(2);
    expect(data.additionalParameters.type).toEqual(['id']);
    expect(data.additionalParameters.version).toEqual(['1.3']);
    expect(data.additionalParameters.memory).toEqual(['19456']);
    expect(registrationNames('Ada.Ming@example.com')).toEqual({ firstName: 'Ada.Ming', lastName: 'Ada.Ming' });
  });
});
