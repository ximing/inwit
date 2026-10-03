import jschardet from 'jschardet';
import { AppError } from '../errors.js';

/** jschardet 4 scores a correct GB18030/Big5 page around 0.3; noise is near 0. */
const MIN_DETECTION_CONFIDENCE = 0.2;
const MAX_REPLACEMENT_RATIO = 0.01;

const LABEL_BY_NAME: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  ascii: 'windows-1252',
  'gb18030': 'gb18030',
  gbk: 'gb18030',
  gb2312: 'gb18030',
  'gb-2312': 'gb18030',
  'hz-gb-2312': 'gb18030',
  chinese: 'gb18030',
  big5: 'big5',
  'big5-hkscs': 'big5',
  cp950: 'big5',
  'shift-jis': 'shift_jis',
  shiftjis: 'shift_jis',
  sjis: 'shift_jis',
  'windows-31j': 'shift_jis',
  cp932: 'shift_jis',
  'euc-kr': 'euc-kr',
  euckr: 'euc-kr',
  cp949: 'euc-kr',
  'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252',
  latin1: 'windows-1252',
  'utf-16': 'utf-16le',
  'utf-16le': 'utf-16le',
  utf16le: 'utf-16le',
  'utf-16be': 'utf-16be',
  utf16be: 'utf-16be',
};

export type DecodedText = {
  text: string;
  encoding: string;
};

export function decodeTextBuffer(buffer: Buffer): DecodedText {
  if (buffer.length === 0) return { text: '', encoding: 'utf-8' };

  const bom = bomLabel(buffer);
  if (bom) {
    const text = decodeWith(buffer, bom, true);
    if (text === null) throw AppError.of(422, 'IMPORT_PARSE_FAILED');
    return acceptDecoded(text, bom, buffer.length);
  }

  const utf16 = sniffUtf16(buffer);
  if (utf16) {
    const text = decodeWith(buffer, utf16, false);
    if (text !== null) return acceptDecoded(text, utf16, buffer.length);
  }

  const utf8 = decodeWith(buffer, 'utf-8', true);
  if (utf8 !== null) return acceptDecoded(utf8, 'utf-8', buffer.length);

  const detected = detectedLabel(buffer);
  if (detected && detected !== 'utf-8') {
    const text = decodeWith(buffer, detected, false);
    if (text !== null && replacementRatio(text) <= MAX_REPLACEMENT_RATIO) {
      return acceptDecoded(text, detected, buffer.length);
    }
  }

  const fallback = decodeWith(buffer, 'gb18030', false);
  if (fallback === null) throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  return acceptDecoded(fallback, 'gb18030', buffer.length);
}

function acceptDecoded(text: string, encoding: string, byteLength: number): DecodedText {
  if (replacementRatio(text) > MAX_REPLACEMENT_RATIO) {
    throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  }
  if (byteLength > 0 && text.trim().length === 0) {
    throw AppError.of(422, 'IMPORT_PARSE_FAILED');
  }
  return { text, encoding };
}

function bomLabel(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';
  return null;
}

/** UTF-16 without a BOM is also valid UTF-8 when the text is mostly ASCII. */
function sniffUtf16(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return null;
  let evenNul = 0;
  let oddNul = 0;
  const pairs = buffer.length / 2;
  for (let i = 0; i < buffer.length; i += 2) {
    if (buffer[i] === 0) evenNul += 1;
    if (buffer[i + 1] === 0) oddNul += 1;
  }
  if (oddNul / pairs > 0.6 && evenNul / pairs < 0.1) return 'utf-16le';
  if (evenNul / pairs > 0.6 && oddNul / pairs < 0.1) return 'utf-16be';
  return null;
}

function detectedLabel(buffer: Buffer): string | null {
  const found = jschardet.detect(buffer);
  if (!found.encoding || found.confidence < MIN_DETECTION_CONFIDENCE) return null;
  const key = found.encoding.trim().toLowerCase().replace(/_/g, '-');
  return LABEL_BY_NAME[key] ?? null;
}

function decodeWith(buffer: Buffer, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function replacementRatio(text: string): number {
  let chars = 0;
  let bad = 0;
  for (const ch of text) {
    chars += 1;
    if (ch === '\uFFFD') bad += 1;
  }
  if (chars === 0) return 0;
  return bad / chars;
}
