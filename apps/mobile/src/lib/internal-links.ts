export type MappedHref =
  | { kind: 'internal'; pathname: string; params?: Record<string, string> }
  | { kind: 'external'; url: string }
  | { kind: 'noop' };

function isHttpUrl(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}

/**
 * Map web app paths onto the Expo router. `/docs?doc=xx` → `/docs/xx`.
 */
export function mapAppHref(href: string): MappedHref {
  const trimmed = href.trim();
  if (!trimmed) return { kind: 'noop' };

  if (isHttpUrl(trimmed)) {
    const url = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    return { kind: 'external', url };
  }

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return { kind: 'noop' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://inwit.local');
  } catch {
    return { kind: 'noop' };
  }

  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const doc = parsed.searchParams.get('doc');
  const anchor = parsed.searchParams.get('anchor');

  if (path === '/docs') {
    if (doc) {
      return {
        kind: 'internal',
        pathname: '/docs/[id]',
        params: anchor ? { id: doc, anchor } : { id: doc },
      };
    }
    return { kind: 'internal', pathname: '/docs' };
  }

  if (path.startsWith('/docs/')) {
    const id = path.slice('/docs/'.length).split('/')[0] ?? '';
    if (!id) return { kind: 'internal', pathname: '/docs' };
    return {
      kind: 'internal',
      pathname: '/docs/[id]',
      params: anchor ? { id, anchor } : { id },
    };
  }

  if (path === '/review' || path.startsWith('/review/')) {
    return { kind: 'internal', pathname: '/review' };
  }
  if (path === '/topics' || path.startsWith('/topics/')) {
    return { kind: 'internal', pathname: '/topics' };
  }
  if (path === '/settings' || path === '/me') {
    return { kind: 'internal', pathname: '/me' };
  }
  if (path === '/') {
    return { kind: 'internal', pathname: '/' };
  }

  return { kind: 'internal', pathname: path };
}

export function asAssetSrc(key: string): string {
  return key.startsWith('asset:') ? key : `asset:${key}`;
}
