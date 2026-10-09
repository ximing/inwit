import type { LookupOptions } from 'node:dns';
import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { AppError } from '../errors.js';
import {
  IMPORT_URL_CODES,
  assertPublicHttpUrl,
  assertResolvedPublic,
  resolvePublicRedirect,
  type PublicLookup,
  type ResolvedAddress,
} from '../net/public-url.js';
import {
  ASSET_IMPORT_MAX_REDIRECTS,
  ASSET_IMPORT_TIMEOUT_MS,
  importDownloadCap,
} from './import-logic.js';

export interface PinnedRequestInit {
  method: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

export interface PinnedMediaResponse {
  status: number;
  headers: { get(name: string): string | null };
  bytes?: Uint8Array;
  body?: AsyncIterable<Uint8Array>;
  discard?: () => void;
}

/** Connection-layer lookup. `hostname` is ignored so the socket cannot re-resolve DNS. */
export type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family: number) => void,
) => void;

export type PinnedMediaRequest = (
  url: URL,
  addresses: readonly ResolvedAddress[],
  init: PinnedRequestInit,
) => Promise<PinnedMediaResponse>;

export interface DownloadPublicMediaDeps {
  lookup?: PublicLookup;
  request?: PinnedMediaRequest;
  signal?: AbortSignal;
}

const ACCEPT = 'image/*,video/*,*/*;q=0.1';

export function createPinnedLookup(addresses: readonly ResolvedAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    const family = typeof options.family === 'number' && options.family !== 0 ? options.family : null;
    const matched = addresses.filter((item) => family == null || item.family === family);
    const first = matched[0];
    if (!first) {
      const error = new Error('getaddrinfo ENOTFOUND') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        matched.map((item) => ({ address: item.address, family: item.family })),
        first.family,
      );
      return;
    }
    callback(null, first.address, first.family);
  };
}

export async function downloadPublicMedia(
  raw: string,
  deps: DownloadPublicMediaDeps = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const lookup = deps.lookup;
  const request = deps.request ?? nodePinnedRequest;
  let current = assertPublicHttpUrl(raw);
  let addresses = await assertResolvedPublic(current.hostname, {
    codes: IMPORT_URL_CODES,
    ...(lookup ? { lookup } : {}),
  });
  const signal = deps.signal ?? (deps.request ? undefined : AbortSignal.timeout(ASSET_IMPORT_TIMEOUT_MS));
  for (let hop = 0; hop <= ASSET_IMPORT_MAX_REDIRECTS; hop += 1) {
    let res: PinnedMediaResponse;
    try {
      res = await request(current, addresses, {
        method: 'GET',
        headers: { Accept: ACCEPT },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.of(400, 'ASSET_IMPORT_FAILED');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      res.discard?.();
      if (!location || hop === ASSET_IMPORT_MAX_REDIRECTS) {
        throw AppError.of(400, 'ASSET_IMPORT_FAILED');
      }
      try {
        current = resolvePublicRedirect(location, current);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw AppError.of(400, 'ASSET_IMPORT_FAILED');
      }
      addresses = await assertResolvedPublic(current.hostname, {
        codes: IMPORT_URL_CODES,
        ...(lookup ? { lookup } : {}),
      });
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.discard?.();
      throw AppError.of(400, 'ASSET_IMPORT_FAILED');
    }
    const contentType = res.headers.get('content-type') ?? '';
    const bytes = await responseBytes(res, importDownloadCap(contentType));
    return { bytes, contentType };
  }
  throw AppError.of(400, 'ASSET_IMPORT_FAILED');
}

function nodePinnedRequest(
  target: URL,
  addresses: readonly ResolvedAddress[],
  init: PinnedRequestInit,
): Promise<PinnedMediaResponse> {
  const sniHost = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const options: RequestOptions & { servername?: string } = {
    method: init.method,
    headers: { ...init.headers, Host: target.host },
    lookup: createPinnedLookup(addresses) as NonNullable<RequestOptions['lookup']>,
    ...(init.signal ? { signal: init.signal } : {}),
    ...(target.protocol === 'https:' && isIP(sniHost) === 0 ? { servername: sniHost } : {}),
  };
  return new Promise((resolve, reject) => {
    const onResponse = (incoming: IncomingMessage): void => {
      resolve({
        status: incoming.statusCode ?? 0,
        headers: incomingHeaders(incoming),
        body: incoming,
        discard: () => {
          incoming.destroy();
        },
      });
    };
    const req =
      target.protocol === 'https:'
        ? https.request(target, options, onResponse)
        : http.request(target, options, onResponse);
    req.on('error', reject);
    req.end();
  });
}

function incomingHeaders(incoming: IncomingMessage): { get(name: string): string | null } {
  return {
    get(name: string): string | null {
      const value = incoming.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value ?? null;
    },
  };
}

async function responseBytes(res: PinnedMediaResponse, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = res.headers.get('content-length');
  const length = lengthHeader == null ? Number.NaN : Number(lengthHeader);
  if (Number.isFinite(length) && length > maxBytes) {
    res.discard?.();
    throw AppError.of(413, 'VALIDATION_ERROR');
  }
  if (res.bytes) {
    if (res.bytes.byteLength > maxBytes) throw AppError.of(413, 'VALIDATION_ERROR');
    return res.bytes;
  }
  if (!res.body) {
    res.discard?.();
    throw AppError.of(400, 'ASSET_IMPORT_FAILED');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        res.discard?.();
        throw AppError.of(413, 'VALIDATION_ERROR');
      }
      if (chunk.byteLength > 0) chunks.push(chunk);
    }
  } catch (err) {
    res.discard?.();
    if (err instanceof AppError) throw err;
    throw AppError.of(400, 'ASSET_IMPORT_FAILED');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
