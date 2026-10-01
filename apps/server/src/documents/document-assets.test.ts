import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PmJson } from '@inwit/doc-schema';
import { presignGet } from '../storage/client.js';
import { resolveDocumentAssets } from './document-assets.js';

vi.mock('../storage/client.js', () => ({ presignGet: vi.fn() }));

const user = '11111111-1111-4111-8111-111111111111';
const image = `asset:users/${user}/doc-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
const video = `asset:users/${user}/doc-assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4`;
const poster = `asset:users/${user}/doc-assets/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const content: PmJson = {
  type: 'doc', content: [
    { type: 'blockquote', content: [{ type: 'paragraph', content: [
      { type: 'image', attrs: { src: image } },
      { type: 'image', attrs: { src: image } },
    ] }] },
    { type: 'video', attrs: { src: video, poster } },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(presignGet).mockImplementation(async (key) => `https://cdn.example/${key}?signed=1`);
});

describe('document response assets', () => {
  it('includes signed URLs for nested images, videos and posters without rewriting the body', async () => {
    const before = JSON.stringify(content);
    const result = await resolveDocumentAssets(user, content);
    expect(result.assetUrls).toEqual({
      [image]: `https://cdn.example/${image.slice(6)}?signed=1`,
      [video]: `https://cdn.example/${video.slice(6)}?signed=1`,
      [poster]: `https://cdn.example/${poster.slice(6)}?signed=1`,
    });
    expect(result.assetUrlsFetchedAt).toBeGreaterThan(0);
    expect(JSON.stringify(content)).toBe(before);
    expect(presignGet).toHaveBeenCalledTimes(3);
  });

  it('does not sign another user’s assets, invalid sources or ordinary links', async () => {
    const result = await resolveDocumentAssets(user, { type: 'doc', content: [
      { type: 'image', attrs: { src: image.replace(user, '22222222-2222-4222-8222-222222222222') } },
      { type: 'image', attrs: { src: 'asset:invalid' } },
      { type: 'image', attrs: { src: 'https://example.com/image.png' } },
      { type: 'text', text: image },
    ] });
    expect(result.assetUrls).toEqual({});
    expect(presignGet).not.toHaveBeenCalled();
  });

  it('keeps the document and other images available when signing one asset fails', async () => {
    vi.mocked(presignGet).mockImplementation(async (key) => {
      if (key === video.slice(6)) throw new Error('storage unavailable');
      return 'https://cdn.example/ready.png';
    });
    const result = await resolveDocumentAssets(user, content);
    expect(result.assetUrls).toEqual({
      [image]: 'https://cdn.example/ready.png',
      [poster]: 'https://cdn.example/ready.png',
    });
  });
});
