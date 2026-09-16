import { describe, expect, it } from 'vitest';
import { toAbsoluteUrl } from './wasm-url-logic';

const origin = 'http://127.0.0.1:5190';

describe('toAbsoluteUrl', () => {
  it('keeps already-absolute http(s) URLs', () => {
    expect(toAbsoluteUrl('https://cdn.example/pdfium.wasm', origin)).toBe(
      'https://cdn.example/pdfium.wasm',
    );
    expect(toAbsoluteUrl('http://127.0.0.1:5190/assets/pdfium.wasm', origin)).toBe(
      'http://127.0.0.1:5190/assets/pdfium.wasm',
    );
  });

  it('keeps blob: and data: URLs', () => {
    expect(toAbsoluteUrl('blob:http://127.0.0.1:5190/abc', origin)).toBe(
      'blob:http://127.0.0.1:5190/abc',
    );
    expect(toAbsoluteUrl('data:application/wasm;base64,AA==', origin)).toBe(
      'data:application/wasm;base64,AA==',
    );
  });

  it('resolves the vite-dev root-relative wasm path against origin', () => {
    expect(toAbsoluteUrl('/node_modules/@embedpdf/pdfium/dist/pdfium.wasm', origin)).toBe(
      'http://127.0.0.1:5190/node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
    );
  });

  it('resolves a relative path against origin', () => {
    expect(toAbsoluteUrl('assets/pdfium.wasm', origin)).toBe(
      'http://127.0.0.1:5190/assets/pdfium.wasm',
    );
  });

  it('returns the input when origin is missing (SSR / tests)', () => {
    expect(toAbsoluteUrl('/node_modules/@embedpdf/pdfium/dist/pdfium.wasm', '')).toBe(
      '/node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
    );
    expect(toAbsoluteUrl('/node_modules/@embedpdf/pdfium/dist/pdfium.wasm')).toBe(
      '/node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
    );
  });

  it('returns empty input unchanged', () => {
    expect(toAbsoluteUrl('', origin)).toBe('');
  });
});
