import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { isUniqueViolation } from '../db/pg.js';
import { oidcIdentities, users, type UserRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { readSessionUser } from './authenticate.js';
import { issueAuthForMode } from './auth.service.js';
import { readSignedCookie } from './cookies.js';
import { consumeLoginIp } from './auth-rate-limit.js';
import {
  allowedAlgs,
  audienceIncludes,
  codeChallengeS256,
  decideEmail,
  displayNameFromClaims,
  endpointAllowed,
  idTokenAccepts,
  isSyntheticEmail,
  keycloakPasswordCredential,
  redactOidcUrl,
  registrationNames,
  resolveOidcConfig,
  sanitizeReturnTo,
  stateMatches,
  syntheticEmail,
  type OidcConfig,
  type OidcErrorCode,
} from './oidc-logic.js';

export const OIDC_COOKIE = 'inwit_oidc';
const COOKIE_TTL_SECONDS = 600;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported?: string[];
};

type Tx = {
  state: string;
  nonce: string;
  verifier: string;
  mode: 'login' | 'bind';
  returnTo: string;
  iat: number;
};

type DiscoveryCache = { issuer: string; doc: Discovery; at: number };

let discoveryCache: DiscoveryCache | null = null;
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
let adminToken: { value: string; exp: number } | null = null;

export function resetOidcCaches(): void {
  discoveryCache = null;
  jwksByIssuer.clear();
  adminToken = null;
}

function web(path: string): string {
  return `${config.WEB_ORIGIN}${path}`;
}

export function oidcFailureLocation(mode: 'login' | 'bind', code?: OidcErrorCode): string {
  if (!code) return web(mode === 'bind' ? '/settings/profile' : '/login');
  if (code === 'OIDC_BIND_SESSION') return web('/login?oidc_error=OIDC_BIND_SESSION');
  if (mode === 'bind' || code === 'OIDC_IDENTITY_TAKEN' || code === 'OIDC_IDENTITY_EXISTS') {
    return web(`/settings/profile?oidc_error=${code}`);
  }
  return web(`/login?oidc_error=${code}`);
}

export function clearOidcCookie(reply: FastifyReply): void {
  void reply.setCookie(OIDC_COOKIE, '', {
    httpOnly: true,
    path: '/api/auth/oidc',
    sameSite: 'lax',
    signed: true,
    secure: config.NODE_ENV === 'production',
    maxAge: 0,
  });
}

function writeOidcCookie(reply: FastifyReply, tx: Tx): void {
  void reply.setCookie(OIDC_COOKIE, JSON.stringify(tx), {
    httpOnly: true,
    path: '/api/auth/oidc',
    sameSite: 'lax',
    signed: true,
    secure: config.NODE_ENV === 'production',
    maxAge: COOKIE_TTL_SECONDS,
  });
}

function readTx(req: FastifyRequest): Tx | null {
  const raw = readSignedCookie(req, OIDC_COOKIE);
  if (!raw) return null;
  try {
    const tx = JSON.parse(raw) as Tx;
    if (tx.mode !== 'login' && tx.mode !== 'bind') return null;
    if (!tx.state || !tx.nonce || !tx.verifier || typeof tx.iat !== 'number') return null;
    if (Date.now() / 1000 - tx.iat > COOKIE_TTL_SECONDS) return null;
    return tx;
  } catch {
    return null;
  }
}

function enabledConfig(): OidcConfig | null {
  const resolved = resolveOidcConfig(config);
  return resolved.enabled ? resolved.config : null;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

async function discovery(cfg: OidcConfig): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === cfg.issuer && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.doc;
  }
  const response = await fetchJson(
    `${cfg.issuer}/.well-known/openid-configuration`,
    { headers: { accept: 'application/json' } },
    5000,
  );
  if (!response.ok) throw new Error(`discovery ${response.status}`);
  const doc = (await response.json()) as Discovery;
  if (doc.issuer !== cfg.issuer) throw new Error('issuer_mismatch');
  for (const endpoint of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) {
    if (!endpointAllowed(endpoint, cfg.issuer)) throw new Error('endpoint');
  }
  discoveryCache = { issuer: cfg.issuer, doc, at: Date.now() };
  return doc;
}

function jwks(doc: Discovery) {
  const cached = jwksByIssuer.get(doc.jwks_uri);
  if (cached) return cached;
  const set = createRemoteJWKSet(new URL(doc.jwks_uri), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  jwksByIssuer.set(doc.jwks_uri, set);
  return set;
}

function mapVerifyError(err: unknown): OidcErrorCode {
  if (err instanceof errors.JWTExpired) return 'OIDC_STATE';
  if (err instanceof errors.JWTClaimValidationFailed) {
    if (err.claim === 'aud') return 'OIDC_AUDIENCE';
    if (err.claim === 'exp' || err.claim === 'nbf') return 'OIDC_STATE';
    if (err.claim === 'iss') return 'OIDC_UNAVAILABLE';
  }
  return 'OIDC_AUDIENCE';
}

async function verifyToken(
  token: string,
  doc: Discovery,
  cfg: OidcConfig,
  audience: string,
): Promise<{ payload: JWTPayload } | { error: OidcErrorCode; alg?: string }> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { error: 'OIDC_AUDIENCE' };
  }
  const algorithms = allowedAlgs(doc.id_token_signing_alg_values_supported);
  if (!alg || !algorithms.includes(alg)) return { error: 'OIDC_AUDIENCE', ...(alg ? { alg } : {}) };
  try {
    const verified = await jwtVerify(token, jwks(doc), {
      issuer: cfg.issuer,
      audience,
      algorithms,
      clockTolerance: 60,
    });
    return { payload: verified.payload };
  } catch (err) {
    return { error: mapVerifyError(err), alg };
  }
}

async function exchange(
  doc: Discovery,
  cfg: OidcConfig,
  code: string,
  verifier: string,
): Promise<{ access: string; id: string } | { error: OidcErrorCode }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
    client_secret: cfg.clientSecret,
  });
  let response: Response;
  try {
    response = await fetchJson(
      doc.token_endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      },
      10_000,
    );
  } catch {
    return { error: 'OIDC_UNAVAILABLE' };
  }
  if (!response.ok) {
    let error = '';
    try {
      error = String(((await response.json()) as { error?: string }).error ?? '');
    } catch {
      error = '';
    }
    if (error === 'invalid_grant' || error === 'access_denied') return { error: 'OIDC_DENIED' };
    return { error: 'OIDC_UNAVAILABLE' };
  }
  const tokens = (await response.json()) as { access_token?: string; id_token?: string };
  if (!tokens.access_token || !tokens.id_token) return { error: 'OIDC_DENIED' };
  return { access: tokens.access_token, id: tokens.id_token };
}

function finish(reply: FastifyReply, user: UserRow, returnTo: string): string {
  issueAuthForMode(reply, user.id, user.sessionVersion, 'cookie');
  return web(returnTo);
}

async function loginIdentity(
  cfg: OidcConfig,
  sub: string,
  claims: JWTPayload,
): Promise<{ user: UserRow; jit: boolean } | { error: OidcErrorCode }> {
  const db = getDb();
  const existing = await db
    .select()
    .from(oidcIdentities)
    .where(and(eq(oidcIdentities.issuer, cfg.issuer), eq(oidcIdentities.sub, sub)))
    .limit(1);
  const found = existing[0];
  if (found) {
    const [user] = await db.select().from(users).where(eq(users.id, found.userId)).limit(1);
    if (!user) return { error: 'OIDC_UNAVAILABLE' };
    return { user, jit: false };
  }
  const emailRaw = claims.email;
  const taken =
    typeof emailRaw === 'string' && emailRaw.trim().length > 0
      ? (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, emailRaw.trim().toLowerCase()))
            .limit(1)
        ).length > 0
      : false;
  const decision = decideEmail(emailRaw, taken);
  if (decision.kind === 'invalid') return { error: 'OIDC_EMAIL_INVALID' };
  if (decision.kind === 'conflict') return { error: 'OIDC_EMAIL_CONFLICT' };
  const email = decision.kind === 'use' ? decision.email : syntheticEmail(cfg.issuer, sub);
  const displayName = displayNameFromClaims(claims.name, claims.preferred_username);
  try {
    return await db.transaction(async (tx) => {
      const [again] = await tx
        .select()
        .from(oidcIdentities)
        .where(and(eq(oidcIdentities.issuer, cfg.issuer), eq(oidcIdentities.sub, sub)))
        .limit(1);
      if (again) {
        const [user] = await tx.select().from(users).where(eq(users.id, again.userId)).limit(1);
        if (!user) throw new Error('missing user');
        return { user, jit: false };
      }
      const [user] = await tx
        .insert(users)
        .values({ email, displayName, passwordHash: null })
        .returning();
      if (!user) throw new Error('insert user');
      await tx.insert(oidcIdentities).values({ userId: user.id, issuer: cfg.issuer, sub });
      return { user, jit: true };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [raced] = await db
      .select()
      .from(oidcIdentities)
      .where(and(eq(oidcIdentities.issuer, cfg.issuer), eq(oidcIdentities.sub, sub)))
      .limit(1);
    if (raced) {
      const [user] = await db.select().from(users).where(eq(users.id, raced.userId)).limit(1);
      if (user) return { user, jit: false };
    }
    return { error: 'OIDC_EMAIL_CONFLICT' };
  }
}

async function bindIdentity(
  cfg: OidcConfig,
  sub: string,
  current: UserRow,
): Promise<{ user: UserRow } | { error: OidcErrorCode }> {
  const db = getDb();
  const [bySub] = await db
    .select()
    .from(oidcIdentities)
    .where(and(eq(oidcIdentities.issuer, cfg.issuer), eq(oidcIdentities.sub, sub)))
    .limit(1);
  if (bySub && bySub.userId !== current.id) return { error: 'OIDC_IDENTITY_TAKEN' };
  if (bySub) return { user: current };
  const [byUser] = await db
    .select()
    .from(oidcIdentities)
    .where(and(eq(oidcIdentities.userId, current.id), eq(oidcIdentities.issuer, cfg.issuer)))
    .limit(1);
  if (byUser) return { error: 'OIDC_IDENTITY_EXISTS' };
  await db.insert(oidcIdentities).values({ userId: current.id, issuer: cfg.issuer, sub });
  return { user: current };
}

function authorizeUrl(doc: Discovery, cfg: OidcConfig, tx: Tx): string {
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scopes);
  url.searchParams.set('state', tx.state);
  url.searchParams.set('nonce', tx.nonce);
  url.searchParams.set('code_challenge', codeChallengeS256(tx.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function logEnd(
  log: FastifyBaseLogger,
  fields: Record<string, unknown>,
): void {
  log.info(fields);
}

export async function oidcStatus(): Promise<{ enabled: boolean }> {
  return { enabled: enabledConfig() !== null };
}

export async function oidcAccount(userId: string): Promise<{
  enabled: boolean;
  linked: boolean;
  hasPassword: boolean;
  emailSynthetic: boolean;
}> {
  const cfg = enabledConfig();
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return { enabled: cfg !== null, linked: false, hasPassword: false, emailSynthetic: false };
  }
  let linked = false;
  if (cfg) {
    const [row] = await getDb()
      .select({ id: oidcIdentities.id })
      .from(oidcIdentities)
      .where(and(eq(oidcIdentities.userId, userId), eq(oidcIdentities.issuer, cfg.issuer)))
      .limit(1);
    linked = Boolean(row);
  }
  return {
    enabled: cfg !== null,
    linked,
    hasPassword: user.passwordHash != null,
    emailSynthetic: isSyntheticEmail(user.email),
  };
}

export async function beginOidc(
  req: FastifyRequest,
  reply: FastifyReply,
  mode: 'login' | 'bind',
  returnRaw: string | undefined,
): Promise<string> {
  const cfg = enabledConfig();
  const fallback = mode === 'bind' ? '/settings/profile' : '/login';
  if (!cfg) return web(fallback);
  if (config.NODE_ENV !== 'test' && !consumeLoginIp(req.ip)) {
    return oidcFailureLocation(mode, 'RATE_LIMITED');
  }
  let current: UserRow | undefined;
  if (mode === 'bind') {
    current = await readSessionUser(req, reply);
    if (!current) return oidcFailureLocation('bind', 'OIDC_BIND_SESSION');
  }
  let doc: Discovery;
  try {
    doc = await discovery(cfg);
  } catch (err) {
    logEnd(req.log, {
      oidcError: 'OIDC_UNAVAILABLE',
      issuerHost: cfg.issuerHost,
      reason: err instanceof Error && err.message === 'issuer_mismatch' ? 'issuer_mismatch' : 'discovery',
    });
    return oidcFailureLocation(mode, 'OIDC_UNAVAILABLE');
  }
  const tx: Tx = {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    mode,
    returnTo: sanitizeReturnTo(returnRaw, config.WEB_ORIGIN) || (mode === 'bind' ? '/settings/profile' : '/'),
    iat: Math.floor(Date.now() / 1000),
  };
  if (mode === 'bind' && !returnRaw) tx.returnTo = '/settings/profile';
  writeOidcCookie(reply, tx);
  return authorizeUrl(doc, cfg, tx);
}

export async function completeOidc(req: FastifyRequest, reply: FastifyReply): Promise<string> {
  clearOidcCookie(reply);
  const cfg = enabledConfig();
  const query = req.query as { code?: string; state?: string; error?: string };
  const tx = readTx(req);
  const mode = tx?.mode ?? 'login';
  if (!cfg) return web('/login');
  const fail = (code: OidcErrorCode, extra: Record<string, unknown> = {}) => {
    logEnd(req.log, { oidcError: code, issuerHost: cfg.issuerHost, mode, ...extra });
    return oidcFailureLocation(mode, code);
  };
  if (!tx) return fail('OIDC_STATE');
  if (query.error) return fail('OIDC_DENIED', { error: query.error });
  if (!stateMatches(tx.state, query.state)) return fail('OIDC_STATE');
  if (!query.code || query.code.length > 2048) return fail('OIDC_DENIED');
  if (config.NODE_ENV !== 'test' && !consumeLoginIp(req.ip)) return fail('RATE_LIMITED');

  let doc: Discovery;
  try {
    doc = await discovery(cfg);
  } catch (err) {
    return fail('OIDC_UNAVAILABLE', {
      reason: err instanceof Error && err.message === 'issuer_mismatch' ? 'issuer_mismatch' : 'discovery',
    });
  }
  const tokens = await exchange(doc, cfg, query.code, tx.verifier);
  if ('error' in tokens) return fail(tokens.error);
  const access = await verifyToken(tokens.access, doc, cfg, cfg.audience);
  if ('error' in access) return fail(access.error, { alg: access.alg, audOk: false });
  const sub = access.payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) return fail('OIDC_SUBJECT', { subPresent: false });
  if (!audienceIncludes(access.payload.aud, cfg.audience)) return fail('OIDC_AUDIENCE', { audOk: false });
  const id = await verifyToken(tokens.id, doc, cfg, cfg.clientId);
  if ('error' in id) return fail(id.error, { alg: id.alg });
  const idError = idTokenAccepts({
    aud: id.payload.aud,
    clientId: cfg.clientId,
    nonce: id.payload.nonce,
    expectedNonce: tx.nonce,
    sub: id.payload.sub,
    accessSub: sub,
  });
  if (idError) return fail(idError);

  if (mode === 'bind') {
    const current = await readSessionUser(req, reply);
    if (!current) return fail('OIDC_BIND_SESSION');
    const linked = await bindIdentity(cfg, sub, current);
    if ('error' in linked) return fail(linked.error);
    logEnd(req.log, { oidcError: null, mode, jit: false, issuerHost: cfg.issuerHost });
    return finish(reply, linked.user, tx.returnTo);
  }
  const logged = await loginIdentity(cfg, sub, id.payload);
  if ('error' in logged) {
    return fail(logged.error, logged.error === 'OIDC_EMAIL_CONFLICT' ? { emailConflict: true } : {});
  }
  logEnd(req.log, { oidcError: null, mode, jit: logged.jit, issuerHost: cfg.issuerHost });
  return finish(reply, logged.user, tx.returnTo);
}

function realmOf(issuer: string): { origin: string; realm: string } {
  const url = new URL(issuer);
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const realm = parts[0] === 'realms' ? parts[1] : undefined;
  if (!realm) throw new Error('realm');
  return { origin: url.origin, realm };
}

function adminReady(): boolean {
  return Boolean(config.OIDC_ADMIN_USER && config.OIDC_ADMIN_PASSWORD);
}

async function adminAccessToken(origin: string): Promise<string> {
  if (adminToken && adminToken.exp > Date.now() + 30_000) return adminToken.value;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: config.OIDC_ADMIN_USER ?? '',
    password: config.OIDC_ADMIN_PASSWORD ?? '',
  });
  const response = await fetchJson(
    `${origin}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    },
    10_000,
  );
  if (!response.ok) throw new Error('admin token');
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('admin token');
  adminToken = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 60) * 1000 };
  return json.access_token;
}

async function keycloakUsersByEmail(cfg: OidcConfig, email: string): Promise<Array<{ id: string }>> {
  const { origin, realm } = realmOf(cfg.issuer);
  const token = await adminAccessToken(origin);
  const query = new URLSearchParams({ email, exact: 'true' });
  const response = await fetchJson(
    `${origin}/admin/realms/${encodeURIComponent(realm)}/users?${query}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
    10_000,
  );
  if (!response.ok) throw new Error(`lookup ${response.status}`);
  const rows = (await response.json()) as Array<{ id?: string }>;
  return rows.filter((row): row is { id: string } => typeof row.id === 'string');
}

/** When OIDC is on, refuse an email that already belongs to a Keycloak user. */
export async function assertOidcEmailAvailable(email: string): Promise<void> {
  const cfg = enabledConfig();
  if (!cfg) return;
  if (!adminReady()) throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  let matches: Array<{ id: string }>;
  try {
    matches = await keycloakUsersByEmail(cfg, email);
  } catch {
    throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  }
  if (matches.length > 0) throw AppError.of(409, 'OIDC_EMAIL_EXISTS');
}

/** Create the Keycloak user and the local identity row. Caller rolls back the Inwit user. */
export async function provisionOidcRegistration(user: UserRow, passwordHash: string): Promise<void> {
  const cfg = enabledConfig();
  if (!cfg) return;
  if (!adminReady()) throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  const credential = keycloakPasswordCredential(passwordHash);
  if (!credential) throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  const { origin, realm } = realmOf(cfg.issuer);
  const names = registrationNames(user.email);
  let token: string;
  try {
    token = await adminAccessToken(origin);
  } catch {
    throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  }
  const response = await fetchJson(
    `${origin}/admin/realms/${encodeURIComponent(realm)}/users`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        username: user.email,
        email: user.email,
        emailVerified: true,
        enabled: true,
        firstName: names.firstName,
        lastName: names.lastName,
        attributes: { inwit_user_id: [user.id] },
        credentials: [
          {
            type: 'password',
            temporary: false,
            secretData: credential.secretData,
            credentialData: credential.credentialData,
          },
        ],
      }),
    },
    10_000,
  );
  if (response.status === 409) throw AppError.of(409, 'OIDC_EMAIL_EXISTS');
  if (response.status !== 201 && response.status !== 204) throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  const location = response.headers.get('location') ?? '';
  const sub = location.replace(/\/$/, '').split('/').pop() ?? '';
  if (!sub) throw AppError.of(503, 'OIDC_PROVISION_FAILED');
  try {
    await getDb().insert(oidcIdentities).values({ userId: user.id, issuer: cfg.issuer, sub });
  } catch (err) {
    await fetchJson(`${origin}/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(sub)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }, 10_000).catch(() => undefined);
    throw err;
  }
}

export function logOidcStartup(log: FastifyBaseLogger): void {
  const resolved = resolveOidcConfig(config);
  if (resolved.enabled) {
    log.info({
      oidc: 'enabled',
      issuerHost: resolved.config.issuerHost,
      audience: resolved.config.audience,
      provision: adminReady(),
    });
    return;
  }
  if (resolved.error) log.error({ oidc: 'disabled', missing: resolved.missing });
  else log.info({ oidc: 'disabled' });
}

export { redactOidcUrl };
