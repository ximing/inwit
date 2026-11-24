/** Sidebar Markdown. Text nodes only — raw HTML stays literal. */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'del'; c: MdInline[] }
  | { t: 'link'; href: string; c: MdInline[] }
  | { t: 'image'; alt: string; src: string };

export type MdItem = { checked: boolean | null; c: MdBlock[] };

export type MdBlock =
  | { t: 'p'; c: MdInline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: MdInline[] }
  | { t: 'quote'; c: MdBlock[] }
  | { t: 'ul'; items: MdItem[] }
  | { t: 'ol'; start: number; items: MdItem[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }
  | { t: 'table'; align: Array<'left' | 'center' | 'right' | ''>; head: MdInline[][]; rows: MdInline[][][] };

const HR_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(\S.*?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const LIST_RE = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith('/') && !href.startsWith('//') && !/[\s<>]/.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function safeImageSrc(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function parseAssistantMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  return parseLines(lines);
}

function parseLines(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = matchFence(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !isCloseFence(lines[i] ?? '', fence.char, fence.len)) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ t: 'code', lang: fence.lang, v: body.join('\n') });
      continue;
    }
    if (HR_RE.test(line.trimEnd())) {
      blocks.push({ t: 'hr' });
      i += 1;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const marks = heading[1] ?? '#';
      const level = Math.min(marks.length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ t: 'h', level, c: parseInlines(heading[2] ?? '') });
      i += 1;
      continue;
    }
    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (current.trim() === '') {
          if ((lines[i + 1] ?? '').trimStart().startsWith('>')) {
            quoted.push('');
            i += 1;
            continue;
          }
          break;
        }
        if (!current.trimStart().startsWith('>')) break;
        quoted.push(current.trimStart().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ t: 'quote', c: parseLines(quoted) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const table = readTable(lines, i);
      blocks.push(table.block);
      i = table.next;
      continue;
    }
    const list = matchList(line);
    if (list) {
      const parsed = parseList(lines, i, list.indent);
      blocks.push(parsed.block);
      i = parsed.next === i ? i + 1 : parsed.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isStructural(lines, i)) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    if (para.length === 0) {
      i += 1;
      continue;
    }
    blocks.push({ t: 'p', c: parseInlines(para.join('\n')) });
  }
  return blocks;
}

function parseList(lines: string[], start: number, baseIndent: number): { block: MdBlock; next: number } {
  const first = matchList(lines[start] ?? '');
  if (!first) return { block: { t: 'ul', items: [] }, next: start + 1 };
  const ordered = first.kind === 'ol';
  const items: MdItem[] = [];
  let i = start;
  while (i < lines.length) {
    const item = matchList(lines[i] ?? '');
    if (!item || item.indent < baseIndent) break;
    if (item.indent > baseIndent) {
      if (items.length === 0) break;
      const nested = parseList(lines, i, item.indent);
      items[items.length - 1]?.c.push(nested.block);
      i = nested.next === i ? i + 1 : nested.next;
      continue;
    }
    if ((item.kind === 'ol') !== ordered) break;
    const parts = [item.text];
    i += 1;
    while (i < lines.length) {
      const cont = lines[i] ?? '';
      if (cont.trim() === '') break;
      const next = matchList(cont);
      if (next && next.indent >= baseIndent) break;
      if (isStructural(lines, i) && leadingSpaces(cont) < baseIndent + 2) break;
      parts.push(cont.trim());
      i += 1;
    }
    const children = parseLines(parts);
    items.push({ checked: item.checked, c: children.length > 0 ? children : [{ t: 'p', c: [] }] });
  }
  const block: MdBlock = ordered
    ? { t: 'ol', start: first.n, items }
    : { t: 'ul', items };
  return { block, next: i };
}

function isStructural(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (line.trim() === '') return false;
  if (matchFence(line) || HR_RE.test(line.trimEnd()) || HEADING_RE.test(line)) return true;
  if (line.trimStart().startsWith('>')) return true;
  if (matchList(line)) return true;
  return isTableStart(lines, index);
}

function matchFence(line: string): { char: string; len: number; lang: string } | null {
  const matched = FENCE_RE.exec(line);
  if (!matched) return null;
  const token = matched[1] ?? '';
  const info = (matched[2] ?? '').trim();
  if (token.startsWith('`') && info.includes('`')) return null;
  return { char: token[0] ?? '`', len: token.length, lang: info.split(/\s+/)[0] ?? '' };
}

function isCloseFence(line: string, char: string, len: number): boolean {
  return new RegExp(`^ {0,3}${char === '`' ? '`' : '~'}{${String(len)},}\\s*$`).test(line);
}

function matchList(line: string): { indent: number; kind: 'ul' | 'ol'; n: number; checked: boolean | null; text: string } | null {
  const matched = LIST_RE.exec(line);
  if (!matched) return null;
  const number = matched[3];
  const box = matched[4];
  return {
    indent: (matched[1] ?? '').replace(/\t/g, '  ').length,
    kind: number ? 'ol' : 'ul',
    n: number ? Number(number) : 1,
    checked: box === undefined ? null : box.toLowerCase() === 'x',
    text: matched[5] ?? '',
  };
}

function leadingSpaces(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].replace(/\t/g, '  ').length ?? 0;
}

function isTableStart(lines: string[], index: number): boolean {
  const head = splitRow(lines[index] ?? '');
  const sep = splitRow(lines[index + 1] ?? '');
  if (!head || !sep || head.length < 2 || sep.length < 2) return false;
  return sep.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function readTable(lines: string[], index: number): { block: MdBlock; next: number } {
  const head = splitRow(lines[index] ?? '') ?? [];
  const sep = splitRow(lines[index + 1] ?? '') ?? [];
  const align = sep.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center' as const;
    if (right) return 'right' as const;
    if (left) return 'left' as const;
    return '' as const;
  });
  const rows: MdInline[][][] = [];
  let i = index + 2;
  while (i < lines.length) {
    const row = splitRow(lines[i] ?? '');
    if (!row || (lines[i] ?? '').trim() === '') break;
    rows.push(fitCells(row, head.length));
    i += 1;
  }
  return {
    block: { t: 'table', align, head: fitCells(head, head.length), rows },
    next: i,
  };
}

function fitCells(cells: string[], width: number): MdInline[][] {
  const out: MdInline[][] = [];
  for (let i = 0; i < width; i += 1) {
    const parsed = parseInlines(cells[i] ?? '');
    out.push(parsed.length > 0 ? parsed : [{ t: 'text', v: '' }]);
  }
  return out;
}

function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  let body = trimmed;
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  if (body.trim() === '') return null;
  return body.split('|').map((cell) => cell.trim());
}

function parseInlines(src: string): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  let i = 0;
  const flush = () => {
    if (text.length > 0) out.push({ t: 'text', v: text });
    text = '';
  };
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '\n') {
      flush();
      out.push({ t: 'br' });
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < src.length && src[i + 1] !== '\n') {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '!' && src[i + 1] === '[') {
      const image = readLink(src, i + 1);
      if (image) {
        flush();
        out.push({ t: 'image', alt: image.label, src: image.href });
        i = image.end;
        continue;
      }
    }
    if (ch === '[') {
      const link = readLink(src, i);
      if (link) {
        flush();
        out.push({ t: 'link', href: link.href, c: parseInlines(link.label) });
        i = link.end;
        continue;
      }
    }
    if (ch === '~' && src[i + 1] === '~') {
      const end = src.indexOf('~~', i + 2);
      if (end !== -1) {
        flush();
        out.push({ t: 'del', c: parseInlines(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const marker = ch + ch;
      const end = src.indexOf(marker, i + 2);
      if (end !== -1) {
        flush();
        out.push({ t: 'strong', c: parseInlines(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ch) {
      const end = findEm(src, i + 1, ch);
      if (end !== -1 && canEm(src, i, end, ch)) {
        flush();
        out.push({ t: 'em', c: parseInlines(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

function findEm(src: string, from: number, ch: string): number {
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src[i] === ch && src[i + 1] !== ch && src[i - 1] !== ch) return i;
  }
  return -1;
}

function canEm(src: string, open: number, close: number, ch: string): boolean {
  if (close === open + 1) return false;
  if (/\s/.test(src[open + 1] ?? '')) return false;
  if (/\s/.test(src[close - 1] ?? '')) return false;
  if (ch === '_' && /\w/.test(src[open - 1] ?? '')) return false;
  if (ch === '_' && /\w/.test(src[close + 1] ?? '')) return false;
  return true;
}

function readLink(src: string, start: number): { label: string; href: string; end: number } | null {
  if (src[start] !== '[') return null;
  const labelEnd = src.indexOf(']', start + 1);
  if (labelEnd === -1 || src[labelEnd + 1] !== '(') return null;
  const hrefEnd = src.indexOf(')', labelEnd + 2);
  if (hrefEnd === -1) return null;
  const href = src.slice(labelEnd + 2, hrefEnd).trim();
  if (href === '' || /\s/.test(href)) return null;
  return { label: src.slice(start + 1, labelEnd), href, end: hrefEnd + 1 };
}
