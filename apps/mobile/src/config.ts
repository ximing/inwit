import Constants from 'expo-constants';

/**
 * Dev default talks to the local Fastify server.
 * On a physical device, localhost is the phone itself — override via
 * app.json `expo.extra.apiBaseUrl` with the machine LAN IP, e.g.
 * `http://192.168.1.12:3020`.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:3020';

type Extra = {
  apiBaseUrl?: string;
  docEngineDevUrl?: string;
};

/**
 * Vite doc-engine dev server. Empty = load the bundled HTML asset.
 * Fill with `http://<LAN-IP>:5199` for hot reload on a physical device.
 */
export const docEngineDevUrl = '';

export function getApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  const fromExtra = extra?.apiBaseUrl?.trim();
  const raw = fromExtra && fromExtra.length > 0 ? fromExtra : DEFAULT_API_BASE_URL;
  return raw.replace(/\/$/, '');
}

export function getDocEngineDevUrl(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  const fromExtra = extra?.docEngineDevUrl?.trim();
  const raw = fromExtra && fromExtra.length > 0 ? fromExtra : docEngineDevUrl.trim();
  return raw.replace(/\/$/, '');
}
