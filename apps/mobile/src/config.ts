import Constants from 'expo-constants';
import { resolveApiBaseUrl } from './config-logic';

export {
  DEFAULT_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
  resolveApiBaseUrl,
  stripTrailingSlash,
} from './config-logic';

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
  return resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, extra?.apiBaseUrl);
}

export function getDocEngineDevUrl(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  const fromExtra = extra?.docEngineDevUrl?.trim();
  const raw = fromExtra && fromExtra.length > 0 ? fromExtra : docEngineDevUrl.trim();
  return raw.replace(/\/$/, '');
}
