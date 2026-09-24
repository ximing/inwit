import { readEtagHeader } from './multipart-logic';

export type PutResult = {
  ok: boolean;
  etag: string | null;
};

export async function putPresigned(
  url: string,
  body: Blob,
  contentType: string | null,
): Promise<PutResult> {
  const headers = new Headers();
  if (contentType !== null) headers.set('Content-Type', contentType);
  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers,
    credentials: 'omit',
  });
  return {
    ok: res.ok,
    etag: readEtagHeader((name) => res.headers.get(name)),
  };
}
