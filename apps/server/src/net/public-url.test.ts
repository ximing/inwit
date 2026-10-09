import { createLlmConfigInputSchema, upsertOcrConfigInputSchema } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';
import {
  IMPORT_URL_CODES,
  REQUEST_ENDPOINT_CODES,
  SAVED_ENDPOINT_CODES,
  assertPublicHttpUrl,
  assertResolvedPublic,
  isBlockedHostname,
  isBlockedIp,
  resolvePublicRedirect,
  type PublicLookup,
} from './public-url.js';

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

async function expectRejected(fn: () => Promise<unknown>, status: number, code: string): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
    expect((err as AppError).code).toBe(code);
    return err as AppError;
  }
  expect.fail('expected AppError');
}

describe('assertPublicHttpUrl', () => {
  it('allows public http(s) URLs, including the system DashScope endpoint', () => {
    expect(assertPublicHttpUrl('https://cdn.example.com/a.png').hostname).toBe('cdn.example.com');
    expect(assertPublicHttpUrl('http://8.8.8.8/v.mp4').hostname).toBe('8.8.8.8');
    expect(assertPublicHttpUrl('https://dashscope.aliyuncs.com/compatible-mode/v1').protocol).toBe('https:');
    expect(assertPublicHttpUrl('http://[2001:db8::1]/a').hostname).toBe('[2001:db8::1]');
    expect(assertPublicHttpUrl('http://[::ffff:8.8.8.8]/a').hostname).toBe('[::ffff:808:808]');
  });

  it('rejects non-http schemes, credentials, names, and literal private addresses', () => {
    expectAppError(() => assertPublicHttpUrl('ftp://example.com/a.png'), 400, 'VALIDATION_ERROR');
    expectAppError(() => assertPublicHttpUrl('https://user:pass@example.com/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('https://localhost/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('https://foo.localhost/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('https://printer.local/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://metadata.google.internal/computeMetadata/v1/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://127.0.0.1/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://10.0.0.5/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://169.254.169.254/latest'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://0.0.0.0/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[::1]/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[::]/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[fe80::1]/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[fc00::1]/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[ff02::1]/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[::ffff:10.0.0.1]/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://[::192.168.0.1]/'), 400, 'ASSET_IMPORT_BLOCKED');
  });

  it('rejects decimal, hex, octal, and short IP literals even when they normalize to a public address', () => {
    expectAppError(() => assertPublicHttpUrl('http://2130706433/a.png'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://134744072/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://0x7f000001/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://0x08080808/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://0177.0.0.1/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://8.8.2056/'), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => assertPublicHttpUrl('http://8.8.8/'), 400, 'ASSET_IMPORT_BLOCKED');
    const base = assertPublicHttpUrl('https://cdn.example.com/a.png');
    expectAppError(() => resolvePublicRedirect('http://2130706433/secret', base), 400, 'ASSET_IMPORT_BLOCKED');
    expectAppError(() => resolvePublicRedirect('http://10.1.2.3/x', base), 400, 'ASSET_IMPORT_BLOCKED');
  });

  it('uses VALIDATION_ERROR for saved endpoints', () => {
    expectAppError(
      () => assertPublicHttpUrl('http://127.0.0.1:11434/v1', SAVED_ENDPOINT_CODES),
      400,
      'VALIDATION_ERROR',
    );
    expect(assertPublicHttpUrl('https://api.example.com/v1', REQUEST_ENDPOINT_CODES).hostname).toBe('api.example.com');
  });
});

describe('isBlockedHostname / isBlockedIp', () => {
  it('keeps the import guards for names and embedded addresses', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('foo.localhost')).toBe(true);
    expect(isBlockedHostname('printer.local')).toBe(true);
    expect(isBlockedHostname('cdn.example.com')).toBe(false);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.255.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('::')).toBe(true);
    expect(isBlockedIp('::ffff:192.168.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true);
    expect(isBlockedIp('ff02::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('::ffff:808:808')).toBe(false);
    expect(isBlockedIp('2001:db8::1')).toBe(false);
  });
});

describe('assertResolvedPublic', () => {
  it('rejects when any looked-up address is non-public and does not leak resolver errors', async () => {
    const lookup = vi.fn<PublicLookup>(async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]);
    await expectRejected(
      () => assertResolvedPublic('cdn.example', { lookup }),
      400,
      'ASSET_IMPORT_BLOCKED',
    );
    expect(lookup).toHaveBeenCalledWith('cdn.example');

    const failed = vi.fn<PublicLookup>(async () => {
      throw new Error('getaddrinfo ENOTFOUND secret.internal');
    });
    const err = await expectRejected(
      () => assertResolvedPublic('cdn.example', { lookup: failed, codes: IMPORT_URL_CODES }),
      400,
      'ASSET_IMPORT_FAILED',
    );
    expect(err.message).not.toContain('secret.internal');
    expect(err.details).toBeUndefined();

    const saved = await expectRejected(
      () => assertResolvedPublic('cdn.example', { lookup: failed, codes: SAVED_ENDPOINT_CODES }),
      400,
      'VALIDATION_ERROR',
    );
    expect(saved.message).not.toContain('secret.internal');
  });

  it('does not resolve names that are already literal-blocked', async () => {
    const lookup = vi.fn<PublicLookup>(async () => [{ address: '8.8.8.8', family: 4 }]);
    await expectRejected(() => assertResolvedPublic('127.0.0.1', { lookup }), 400, 'ASSET_IMPORT_BLOCKED');
    await expectRejected(() => assertResolvedPublic('10.1.2.3', { lookup }), 400, 'ASSET_IMPORT_BLOCKED');
    await expectRejected(() => assertResolvedPublic('169.254.169.254', { lookup }), 400, 'ASSET_IMPORT_BLOCKED');
    await expectRejected(() => assertResolvedPublic('localhost', { lookup }), 400, 'ASSET_IMPORT_BLOCKED');
    await expectRejected(() => assertResolvedPublic('2130706433', { lookup }), 400, 'ASSET_IMPORT_BLOCKED');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns the looked-up public addresses', async () => {
    const addresses = [{ address: '93.184.216.34', family: 4 }];
    const lookup = vi.fn<PublicLookup>(async () => addresses);
    await expect(assertResolvedPublic('cdn.example', { lookup })).resolves.toEqual(addresses);
  });
});

describe('endpoint baseUrl schemas', () => {
  it('treats empty baseUrl as null and requires a URL otherwise', () => {
    expect(upsertOcrConfigInputSchema.parse({}).baseUrl).toBeUndefined();
    expect(upsertOcrConfigInputSchema.parse({ baseUrl: '' }).baseUrl).toBeNull();
    expect(upsertOcrConfigInputSchema.parse({ baseUrl: '   ' }).baseUrl).toBeNull();
    expect(upsertOcrConfigInputSchema.parse({ baseUrl: null }).baseUrl).toBeNull();
    expect(upsertOcrConfigInputSchema.parse({ baseUrl: ' https://example.com/v1 ' }).baseUrl).toBe(
      'https://example.com/v1',
    );
    expect(upsertOcrConfigInputSchema.safeParse({ baseUrl: 'not a url' }).success).toBe(false);
    expect(
      createLlmConfigInputSchema.parse({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseUrl: '',
      }).baseUrl,
    ).toBeNull();
    expect(
      createLlmConfigInputSchema.safeParse({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseUrl: 'not a url',
      }).success,
    ).toBe(false);
  });
});
