import { ASSET_IMAGE_MAX_BYTES, ASSET_VIDEO_MAX_BYTES } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  classifyImportedBytes,
  importDownloadCap,
  isBlockedHostname,
  isBlockedIp,
  kindFromMime,
  parseImportUrl,
  sniffAssetMime,
} from './import-logic.js';

function expectAppError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
    expect((err as AppError).code).toBe(code);
    return;
  }
  expect.fail('expected AppError');
}

describe('parseImportUrl / SSRF guards', () => {
  it('accepts public http(s) URLs', () => {
    expect(parseImportUrl('https://cdn.example.com/a.png').hostname).toBe('cdn.example.com');
    expect(parseImportUrl('http://example.org/v.mp4').protocol).toBe('http:');
  });

  it('rejects non-http schemes, credentials, localhost, and private IP literals', () => {
    expectAppError(() => parseImportUrl('ftp://example.com/a.png'), 400, 'VALIDATION_ERROR');
    expectAppError(() => parseImportUrl('https://user:pass@example.com/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('https://localhost/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('http://127.0.0.1/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('http://192.168.1.8/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('http://10.0.0.5/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('http://169.254.169.254/latest'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => parseImportUrl('http://[::1]/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
  });

  it('flags blocked hostnames and IPs used after DNS lookup', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('foo.localhost')).toBe(true);
    expect(isBlockedHostname('printer.local')).toBe(true);
    expect(isBlockedHostname('cdn.example.com')).toBe(false);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('::ffff:192.168.0.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
});

describe('classifyImportedBytes', () => {
  it('sniffs a PNG and maps jpeg/webp/gif headers', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    expect(sniffAssetMime(png)).toEqual({ kind: 'image', mime: 'image/png', ext: 'png' });
    expect(kindFromMime('image/jpeg; charset=binary')).toEqual({
      kind: 'image',
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(classifyImportedBytes('image/png', png)).toEqual({
      kind: 'image',
      mime: 'image/png',
      ext: 'png',
    });
  });

  it('rejects empty payloads, unknown bytes, and oversize images', () => {
    expectAppError(() => classifyImportedBytes('image/png', new Uint8Array()), 413, 'VALIDATION_ERROR');
    expectAppError(() => classifyImportedBytes('text/html', Uint8Array.from([1, 2, 3])), 400, 'ASSET_IMPORT_FAILED');
    const tooBig = new Uint8Array(ASSET_IMAGE_MAX_BYTES + 1);
    tooBig[0] = 0x89;
    tooBig[1] = 0x50;
    tooBig[2] = 0x4e;
    tooBig[3] = 0x47;
    expectAppError(() => classifyImportedBytes('image/png', tooBig), 413, 'VALIDATION_ERROR');
  });

  it('uses the image cap for image content types and the video cap otherwise', () => {
    expect(importDownloadCap('image/webp')).toBe(ASSET_IMAGE_MAX_BYTES);
    expect(importDownloadCap('video/mp4')).toBe(ASSET_VIDEO_MAX_BYTES);
    expect(importDownloadCap('application/octet-stream')).toBe(ASSET_VIDEO_MAX_BYTES);
  });
});
