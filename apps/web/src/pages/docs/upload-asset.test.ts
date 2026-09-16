import { ASSET_IMAGE_MAX_BYTES, ASSET_VIDEO_MAX_BYTES } from '@inwit/dto';
import { serializePmJSONToMarkdown } from '@inwit/markdown';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_DOC_PARAGRAPH } from './editor.service';
import {
  AssetUploadError,
  classifyAssetFile,
  ingestAssetFiles,
  UPLOAD_FAILED_MESSAGE,
  uploadDocAsset,
  type UploadDocAssetApi,
  type UploadDocAssetEditor,
} from './upload-asset';

function isBlankMarkdown(markdown: string): boolean {
  return markdown.replaceAll(EMPTY_DOC_PARAGRAPH, '').trim().length === 0;
}

function fileOf(name: string, type: string, body: string): File {
  return new File([body], name, { type });
}

function mockApi(overrides: Partial<UploadDocAssetApi> = {}): UploadDocAssetApi & {
  presign: ReturnType<typeof vi.fn>;
  initMultipart: ReturnType<typeof vi.fn>;
  signMultipart: ReturnType<typeof vi.fn>;
  completeMultipart: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  return {
    presign: vi.fn(),
    initMultipart: vi.fn(),
    signMultipart: vi.fn(),
    completeMultipart: vi.fn(),
    put: vi.fn(),
    ...overrides,
  };
}

function mockEditor(): UploadDocAssetEditor & {
  insertImage: ReturnType<typeof vi.fn>;
  insertVideo: ReturnType<typeof vi.fn>;
  ensure: ReturnType<typeof vi.fn>;
} {
  return {
    insertImage: vi.fn(),
    insertVideo: vi.fn(),
    ensure: vi.fn(async () => undefined),
  };
}

describe('classifyAssetFile', () => {
  it('accepts T2 image and video MIME types within size limits', () => {
    expect(classifyAssetFile({ type: 'image/png', size: 1024 })).toEqual({
      ok: true,
      kind: 'image',
      mime: 'image/png',
    });
    expect(classifyAssetFile({ type: 'IMAGE/JPEG; charset=binary', size: 10 })).toEqual({
      ok: true,
      kind: 'image',
      mime: 'image/jpeg',
    });
    expect(classifyAssetFile({ type: 'video/quicktime', size: 20 * 1024 * 1024 })).toEqual({
      ok: true,
      kind: 'video',
      mime: 'video/quicktime',
    });
  });

  it('rejects unsupported MIME, empty files, and oversize payloads', () => {
    expect(classifyAssetFile({ type: 'image/heic', size: 100 }).ok).toBe(false);
    expect(classifyAssetFile({ type: 'image/png', size: 0 }).ok).toBe(false);
    expect(classifyAssetFile({ type: 'image/png', size: ASSET_IMAGE_MAX_BYTES + 1 })).toEqual({
      ok: false,
      message: '图片不能超过 10MB',
    });
    expect(classifyAssetFile({ type: 'video/mp4', size: ASSET_VIDEO_MAX_BYTES + 1 })).toEqual({
      ok: false,
      message: '视频不能超过 200MB',
    });
    expect(classifyAssetFile({ type: 'application/pdf', size: 100 }).ok).toBe(false);
  });
});

describe('uploadDocAsset', () => {
  it('rejects invalid files before any network call', async () => {
    const api = mockApi();
    const editor = mockEditor();
    await expect(uploadDocAsset(fileOf('a.txt', 'text/plain', 'hi'), api, editor)).rejects.toMatchObject({
      name: 'AssetUploadError',
      code: 'invalid',
    });
    expect(api.presign).not.toHaveBeenCalled();
    expect(api.initMultipart).not.toHaveBeenCalled();
    expect(editor.insertImage).not.toHaveBeenCalled();
  });

  it('uploads a small image via presign PUT, inserts, then warms the cache', async () => {
    const api = mockApi({
      presign: vi.fn(async () => ({
        uploadUrl: 'https://s3.example/put',
        key: 'users/u/doc-assets/a.png',
        assetSrc: 'asset:users/u/doc-assets/a.png',
      })),
      put: vi.fn(async () => ({ ok: true, etag: '"abc"' })),
    });
    const editor = mockEditor();
    const file = fileOf('shot.png', 'image/png', 'png-bytes');
    const src = await uploadDocAsset(file, api, editor);
    expect(src).toBe('asset:users/u/doc-assets/a.png');
    expect(api.presign).toHaveBeenCalledWith({
      kind: 'image',
      contentType: 'image/png',
      sizeBytes: file.size,
    });
    expect(api.put).toHaveBeenCalledWith('https://s3.example/put', file, 'image/png');
    expect(api.initMultipart).not.toHaveBeenCalled();
    expect(editor.insertImage).toHaveBeenCalledWith(src, 'shot.png');
    expect(editor.insertVideo).not.toHaveBeenCalled();
    expect(editor.ensure).toHaveBeenCalledWith([src]);
  });

  it('uploads oversized files via multipart init / per-part sign / complete', async () => {
    const api = mockApi({
      initMultipart: vi.fn(async () => ({
        uploadId: 'up-1',
        key: 'users/u/doc-assets/v.mp4',
        assetSrc: 'asset:users/u/doc-assets/v.mp4',
        partSize: 4,
      })),
      signMultipart: vi.fn(async (input) => ({
        parts: input.partNumbers.map((partNumber) => ({
          partNumber,
          uploadUrl: `https://s3.example/part-${partNumber}`,
        })),
      })),
      put: vi.fn(async (url: string) => ({ ok: true, etag: `etag-${url.slice(-1)}` })),
      completeMultipart: vi.fn(async () => ({
        key: 'users/u/doc-assets/v.mp4',
        assetSrc: 'asset:users/u/doc-assets/v.mp4',
      })),
    });
    const editor = mockEditor();
    const file = fileOf('clip.mp4', 'video/mp4', 'abcdef');
    const src = await uploadDocAsset(file, api, editor, { multipartThreshold: 4 });
    expect(src).toBe('asset:users/u/doc-assets/v.mp4');
    expect(api.presign).not.toHaveBeenCalled();
    expect(api.initMultipart).toHaveBeenCalledWith({
      kind: 'video',
      contentType: 'video/mp4',
      sizeBytes: file.size,
    });
    expect(api.signMultipart).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenNthCalledWith(1, 'https://s3.example/part-1', expect.any(Blob), null);
    expect(api.put).toHaveBeenNthCalledWith(2, 'https://s3.example/part-2', expect.any(Blob), null);
    expect(api.completeMultipart).toHaveBeenCalledWith({
      uploadId: 'up-1',
      key: 'users/u/doc-assets/v.mp4',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
      ],
    });
    expect(editor.insertVideo).toHaveBeenCalledWith(src, 'video/mp4');
    expect(editor.ensure).toHaveBeenCalledWith([src]);
  });

  it('throws the retry message when a simple PUT fails', async () => {
    const api = mockApi({
      presign: vi.fn(async () => ({
        uploadUrl: 'https://s3.example/put',
        key: 'users/u/doc-assets/a.png',
        assetSrc: 'asset:users/u/doc-assets/a.png',
      })),
      put: vi.fn(async () => ({ ok: false, etag: null })),
    });
    const editor = mockEditor();
    await expect(uploadDocAsset(fileOf('a.png', 'image/png', 'x'), api, editor)).rejects.toBeInstanceOf(
      AssetUploadError,
    );
    await expect(uploadDocAsset(fileOf('a.png', 'image/png', 'x'), api, editor)).rejects.toMatchObject({
      message: UPLOAD_FAILED_MESSAGE,
      code: 'failed',
    });
    expect(editor.insertImage).not.toHaveBeenCalled();
  });
});

describe('ingestAssetFiles', () => {
  it('uploads files one by one and stops on the first failure', async () => {
    const api = mockApi({
      presign: vi
        .fn()
        .mockResolvedValueOnce({
          uploadUrl: 'https://s3.example/1',
          key: 'users/u/doc-assets/a.png',
          assetSrc: 'asset:users/u/doc-assets/a.png',
        })
        .mockRejectedValueOnce(new Error('network')),
      put: vi.fn(async () => ({ ok: true, etag: '"x"' })),
    });
    const editor = mockEditor();
    await expect(
      ingestAssetFiles(
        [fileOf('a.png', 'image/png', 'a'), fileOf('b.png', 'image/png', 'b')],
        api,
        editor,
      ),
    ).rejects.toThrow('network');
    expect(editor.insertImage).toHaveBeenCalledTimes(1);
    expect(api.presign).toHaveBeenCalledTimes(2);
  });
});

describe('empty editor serialization vs isBlankMarkdown', () => {
  it('treats an empty paragraph and a ZWSP placeholder as blank', () => {
    expect(
      isBlankMarkdown(serializePmJSONToMarkdown({ type: 'doc', content: [{ type: 'paragraph' }] })),
    ).toBe(true);
    expect(
      isBlankMarkdown(
        serializePmJSONToMarkdown({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: EMPTY_DOC_PARAGRAPH }] }],
        }),
      ),
    ).toBe(true);
  });
});
