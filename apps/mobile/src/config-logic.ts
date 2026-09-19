/** Dev default talks to the local Fastify server. */
export const DEFAULT_API_BASE_URL = 'http://localhost:3020';

/** Production default baked into GitHub Release clients. */
export const DEFAULT_PROD_API_BASE_URL = 'https://inwit.aimo.plus';

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/** Env wins, then Expo `extra`, then the local-dev default. */
export function resolveApiBaseUrl(
  envUrl?: string | null,
  extraUrl?: string | null,
  fallback = DEFAULT_API_BASE_URL,
): string {
  for (const candidate of [envUrl, extraUrl, fallback]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return stripTrailingSlash(candidate.trim());
    }
  }
  return stripTrailingSlash(fallback);
}
