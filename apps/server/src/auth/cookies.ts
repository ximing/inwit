import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export const ACCESS_COOKIE_NAME = 'inwit_at';
export const REFRESH_COOKIE_NAME = 'inwit_rt';

function cookieSecure(): boolean {
  return config.NODE_ENV === 'production';
}

function cookieBase() {
  return {
    httpOnly: true as const,
    path: '/',
    sameSite: 'lax' as const,
    signed: true as const,
    secure: cookieSecure(),
  };
}

export function setAccessCookie(reply: FastifyReply, raw: string): void {
  void reply.setCookie(ACCESS_COOKIE_NAME, raw, {
    ...cookieBase(),
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function setRefreshCookie(reply: FastifyReply, raw: string): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, raw, {
    ...cookieBase(),
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const base = cookieBase();
  void reply.setCookie(ACCESS_COOKIE_NAME, '', { ...base, maxAge: 0 });
  void reply.setCookie(REFRESH_COOKIE_NAME, '', { ...base, maxAge: 0 });
}

export function readSignedCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.cookies[name];
  if (!raw) return undefined;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid) return undefined;
  return unsigned.value;
}
