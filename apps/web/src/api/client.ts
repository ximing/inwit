import type { AuthResponse, AuthTokens } from '@inwit/dto';
import {
  apiBaseUrl,
  apiCredentials,
  apiFetch,
  isTauriRuntime,
  tokenStore,
} from './tauri';

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

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function errorMessage(err: unknown, fallback = '请求失败'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export type RequestOptions = RequestInit & {
  skipAuth?: boolean;
  skipAuthRefresh?: boolean;
};

function isAuthTokens(value: unknown): value is AuthTokens {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.accessToken !== 'string' || typeof rec.expiresIn !== 'number') return false;
  return rec.refreshToken === undefined || typeof rec.refreshToken === 'string';
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.user !== 'object' || rec.user === null) return false;
  return rec.tokens === undefined || isAuthTokens(rec.tokens);
}

async function settle(result: Promise<void> | void): Promise<void> {
  try {
    await result;
  } catch {
    // TokenStore failures must not mask ApiError.
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let data: unknown;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = undefined;
    }
  }
  const parsed = isErrorBody(data) ? data.error : undefined;
  return new ApiError(
    res.status,
    parsed?.code ?? 'UNKNOWN',
    parsed?.message ?? (text.length > 0 ? text : res.statusText),
    parsed && 'details' in parsed ? parsed.details : undefined,
  );
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

let refreshPromise: Promise<AuthResponse> | null = null;

export async function persistAuth(tokens: AuthTokens | undefined): Promise<void> {
  if (!tokens) return;
  await tokenStore.setTokens(tokens);
}

export async function clearAuth(): Promise<void> {
  await settle(tokenStore.clear());
  onUnauthorized?.();
}

export async function refreshSession(): Promise<AuthResponse> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken === null || refreshToken === '') {
      throw new ApiError(401, 'INVALID_TOKEN', '登录已过期');
    }
    const res = await doFetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
      skipAuthRefresh: true,
    });
    if (!res.ok) {
      const err = await toApiError(res);
      if (err.status === 401) await clearAuth();
      throw err;
    }
    const data: unknown = await parseBody(res);
    if (!isAuthResponse(data) || !data.tokens) {
      throw new ApiError(0, 'INVALID_RESPONSE', '响应格式错误');
    }
    await persistAuth(data.tokens);
    return data;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function bootAuth(): Promise<void> {
  if (!isTauriRuntime()) return;
  const existing = await tokenStore.getAccessToken();
  if (existing !== null && existing !== '') return;
  const refreshToken = await tokenStore.getRefreshToken();
  if (refreshToken === null || refreshToken === '') return;
  try {
    await refreshSession();
  } catch {
    // bootstrap falls through to getMe, which surfaces guest vs unreachable.
  }
}

async function doFetch(path: string, init: RequestOptions, tokenOverride?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  const form = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body !== undefined && !headers.has('Content-Type') && !form) {
    headers.set('Content-Type', 'application/json');
  }

  let token = tokenOverride;
  if (token === undefined && init.skipAuth !== true && isTauriRuntime()) {
    const stored = await tokenStore.getAccessToken();
    if (stored !== null && stored !== '') token = stored;
  }
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);

  const { skipAuth: _s, skipAuthRefresh: _r, ...rest } = init;
  const url = `${apiBaseUrl()}${path}`;
  try {
    return await apiFetch()(url, {
      ...rest,
      headers,
      credentials: rest.credentials ?? apiCredentials(),
    });
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : '网络错误');
  }
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const first = await doFetch(path, init);
  if (
    first.status === 401 &&
    init.skipAuth !== true &&
    init.skipAuthRefresh !== true &&
    isTauriRuntime()
  ) {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) {
      const refreshed = await refreshSession();
      const second = await doFetch(path, init, refreshed.tokens?.accessToken);
      if (!second.ok) {
        const err = await toApiError(second);
        if (err.code === 'INVALID_TOKEN') await clearAuth();
        throw err;
      }
      return parseBody<T>(second);
    }
  }

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
    if (err.code === 'INVALID_TOKEN') await clearAuth();
    throw err;
  }

  return data as T;
}
