import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { decodeTextBuffer } from './text-encoding.js';

const GB18030_NOTE = Buffer.from(
  'd1a7cfb0b1cabcc7a3babce4b8f4d6d8b8b4c4dcb0d1b6ccc6dabcc7d2e4b1e4b3c9b3a4c6dabcc7d2e4a1a3bdf1cceccfc8d0b4cfc2d2bbd0a1b6cea3acc3f7ccecd4d9b8b4cfb0a1a3',
  'hex',
);
const BIG5_NOTE = Buffer.from(
  'bec7b2dfb5a7b04fa147b6a1b96aadabbdc6afe0a7e2b575b4c1b04fbed0c5dca6a8aaf8b4c1b04fbed0a143a4b5a4d1a5fdbc67a455a440a470ac71a141a9faa4d1a641bdc6b2dfa143',
  'hex',
);

describe('decodeTextBuffer', () => {
  it('reads UTF-8, including a leading BOM', () => {
    expect(decodeTextBuffer(Buffer.from('学习笔记', 'utf8'))).toEqual({
      text: '学习笔记',
      encoding: 'utf-8',
    });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('学习笔记', 'utf8')]);
    expect(decodeTextBuffer(bom)).toEqual({ text: '学习笔记', encoding: 'utf-8' });
  });

  it('reads UTF-16 LE when a BOM is present', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('学习笔记', 'utf16le')]);
    expect(decodeTextBuffer(bytes)).toEqual({ text: '学习笔记', encoding: 'utf-16le' });
  });

  it('reads UTF-16 LE without a BOM when the high bytes are NUL', () => {
    expect(decodeTextBuffer(Buffer.from('hello notes', 'utf16le'))).toEqual({
      text: 'hello notes',
      encoding: 'utf-16le',
    });
  });

  it('reads GB18030 and Big5', () => {
    expect(decodeTextBuffer(GB18030_NOTE).text.startsWith('学习笔记')).toBe(true);
    expect(decodeTextBuffer(GB18030_NOTE).encoding).toBe('gb18030');
    const big5 = decodeTextBuffer(BIG5_NOTE);
    expect(big5.text.startsWith('學習筆記')).toBe(true);
    expect(big5.encoding).toBe('big5');
  });

  it('rejects bytes that do not decode to text', () => {
    expect(() => decodeTextBuffer(Buffer.alloc(64, 0xff))).toThrowError(
      expect.objectContaining({ status: 422, code: 'IMPORT_PARSE_FAILED' } as Partial<AppError>),
    );
  });

  it('rejects a non-empty buffer that decodes to whitespace', () => {
    expect(() => decodeTextBuffer(Buffer.from(' \n\t ', 'utf8'))).toThrowError(
      expect.objectContaining({ code: 'IMPORT_PARSE_FAILED' } as Partial<AppError>),
    );
  });

  it('returns an empty string for an empty buffer', () => {
    expect(decodeTextBuffer(Buffer.alloc(0))).toEqual({ text: '', encoding: 'utf-8' });
  });
});
