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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const form = typeof FormData !== 'undefined' && init.body instanceof FormData;
  // FormData must keep the browser-generated multipart boundary.
  if (init.body !== undefined && !headers.has('Content-Type') && !form) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const parsed = isErrorBody(data) ? data.error : undefined;
    const err = new ApiError(
      res.status,
      parsed?.code ?? 'UNKNOWN',
      parsed?.message ?? (text.length > 0 ? text : res.statusText),
      parsed && 'details' in parsed ? parsed.details : undefined,
    );
    if (err.code === 'INVALID_TOKEN') onUnauthorized?.();
    throw err;
  }

  return data as T;
}
