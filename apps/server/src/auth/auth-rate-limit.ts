import { AppError } from '../errors.js';

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const REGISTER_IP_LIMIT = 5;
const LOGIN_IP_LIMIT = 20;
const LOGIN_EMAIL_LIMIT = 10;
const REFRESH_IP_LIMIT = 30;

type Bucket = { start: number; count: number; windowMs: number };

const buckets = new Map<string, Bucket>();

export function resetAuthRateLimits(): void {
  buckets.clear();
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= bucket.windowMs) buckets.delete(key);
  }
}

/** Fixed window. Returns false when this call would exceed `limit`. */
function consume(key: string, limit: number, windowMs: number, now: number): boolean {
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || now - existing.start >= windowMs) {
    buckets.set(key, { start: now, count: 1, windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function deny(): never {
  throw AppError.of(429, 'RATE_LIMITED');
}

export function assertRegisterRateLimit(ip: string, now = Date.now()): void {
  if (!consume(`register:ip:${normalizeIp(ip)}`, REGISTER_IP_LIMIT, HOUR_MS, now)) deny();
}

export function assertLoginRateLimit(ip: string, email: string, now = Date.now()): void {
  if (!consume(`login:ip:${normalizeIp(ip)}`, LOGIN_IP_LIMIT, FIFTEEN_MIN_MS, now)) deny();
  if (!consume(`login:email:${normalizeEmail(email)}`, LOGIN_EMAIL_LIMIT, FIFTEEN_MIN_MS, now)) {
    deny();
  }
}

export function assertRefreshRateLimit(ip: string, now = Date.now()): void {
  if (!consume(`refresh:ip:${normalizeIp(ip)}`, REFRESH_IP_LIMIT, FIFTEEN_MIN_MS, now)) deny();
}
