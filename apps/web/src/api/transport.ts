export function browserUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API path must be a same-origin path');
  }
  return path;
}

export function browserFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (headers.has('Authorization')) {
    throw new Error('API transport must not set Authorization');
  }
  return fetch(url, { ...init, headers, credentials: 'include' });
}
