import type { AuthTokens } from '@inwit/dto';
import { getApiBaseUrl } from '../config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  if (!('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  return (
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

export type RequestOptions = RequestInit & {
  skipAuth?: boolean;
  skipAuthRefresh?: boolean;
};

export type MobileClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  onUnauthorized?: () => void;
};

let baseUrl = getApiBaseUrl();
let getToken: () => Promise<string | null> = async () => null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function errorMessage(err: unknown, fallback = '请求失败'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** JWT persist is a no-op on mobile; AuthService stores the PAT instead. */
export async function persistAuth(_tokens: AuthTokens | undefined): Promise<void> {
  return;
}

/** Cookie/JWT store is unused; PAT lifecycle lives on AuthService. */
export const tokenStore = {
  async clear(): Promise<void> {
    return;
  },
};

export async function clearAuth(): Promise<void> {
  onUnauthorized?.();
}

function configure(options: MobileClientOptions): void {
  baseUrl = options.baseUrl.replace(/\/$/, '');
  getToken = options.getToken;
  if (options.onUnauthorized !== undefined) {
    onUnauthorized = options.onUnauthorized;
  }
}

export function createMobileClient(options: MobileClientOptions): {
  request: typeof request;
  setUnauthorizedHandler: typeof setUnauthorizedHandler;
} {
  configure(options);
  return { request, setUnauthorizedHandler };
}

async function doFetch(path: string, init: RequestOptions): Promise<Response> {
  const headers = new Headers(init.headers);
  const form = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body !== undefined && !headers.has('Content-Type') && !form) {
    headers.set('Content-Type', 'application/json');
  }

  if (init.skipAuth !== true) {
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const { skipAuth: _s, skipAuthRefresh: _r, ...rest } = init;
  const url = `${baseUrl}${path}`;
  try {
    return await fetch(url, {
      ...rest,
      headers,
    });
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : '网络错误');
  }
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const first = await doFetch(path, init);

  if (first.status === 204) return undefined as T;

  const text = await first.text();
  let data: unknown;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = undefined;
    }
  }

  if (!first.ok) {
    const parsed = isErrorBody(data) ? data.error : undefined;
    const err = new ApiError(
      first.status,
      parsed?.code ?? 'UNKNOWN',
      parsed?.message ?? (text.length > 0 ? text : first.statusText),
      parsed && 'details' in parsed ? parsed.details : undefined,
    );
    if (err.code === 'INVALID_TOKEN' && init.skipAuth !== true) await clearAuth();
    throw err;
  }

  return data as T;
}
