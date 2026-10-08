import { CONVERSATION_MENTION_MAX, type ConversationAction } from '@inwit/dto';

export type ChatInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: ChatInline[] }
  | { t: 'em'; c: ChatInline[] }
  | { t: 'del'; c: ChatInline[] }
  | { t: 'link'; href: string; c: ChatInline[] }
  | { t: 'image'; alt: string; src: string };

export type ChatItem = { c: ChatBlock[] };

export type ChatBlock =
  | { t: 'p'; c: ChatInline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: ChatInline[] }
  | { t: 'ul'; items: ChatItem[] }
  | { t: 'ol'; start: number; items: ChatItem[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; align: Array<'left' | 'center' | 'right' | ''>; head: ChatInline[][]; rows: ChatInline[][][] };

const HEADING_RE = /^ {0,3}(#{1,6})\s+(\S.*?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const LIST_RE = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

/** Keep the first occurrences, at most the conversation mention cap. */
export function capDocumentMentions(
  ids: readonly string[],
  max = CONVERSATION_MENTION_MAX,
): string[] {
  const limit = Number.isInteger(max) && max > 0 ? max : 0;
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || out.includes(id)) continue;
    if (out.length >= limit) break;
    out.push(id);
  }
  return out;
}

/** The open reader's unsaved body is the only dirty document the agent must avoid. */
export function dirtyDocumentIds(documentId: string | null, bodyDirty: boolean): string[] {
  if (!bodyDirty || !documentId) return [];
  return [documentId];
}

export function conversationActionLine(
  action: ConversationAction,
  dirtyDocumentId: string | null,
): { text: string; documentId: string } {
  if (action.type === 'update_document') {
    if (action.status === 'blocked_dirty') {
      return { text: `《${action.title}》有未保存的修改，这次没有写入`, documentId: action.documentId };
    }
    if (action.status === 'applied' && dirtyDocumentId === action.documentId) {
      return {
        text: `《${action.title}》已写入，但这边还有未保存的修改，正文仍是你的草稿`,
        documentId: action.documentId,
      };
    }
    if (action.status === 'applied') {
      return { text: `已更新《${action.title}》`, documentId: action.documentId };
    }
    const reason = action.reason ? `：${action.reason}` : '';
    return { text: `没能修改《${action.title}》${reason}`, documentId: action.documentId };
  }
  if (action.type === 'create_document') {
    return { text: `已新建《${action.title}》`, documentId: action.documentId };
  }
  if (action.type === 'update_mind_node') {
    if (action.status === 'applied') {
      return { text: `已更新节点「${action.title}」`, documentId: action.documentId };
    }
    const reason = action.reason ? `：${action.reason}` : '';
    return { text: `没能修改节点「${action.title}」${reason}`, documentId: action.documentId };
  }
  return {
    text: `已写入 ${String(action.count)} 张卡片到《${action.title}》`,
    documentId: action.documentId,
  };
}

/** User turns stay literal. Assistant turns use the Markdown subset. */
export function messageBodyKind(role: 'user' | 'assistant'): 'plain' | 'markdown' {
  return role === 'user' ? 'plain' : 'markdown';
}

export function pendingStatusLine(activity: string | null | undefined): string {
  const trimmed = activity?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : '正在处理…';
}

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith('/') && !href.startsWith('//') && !/[\s<>]/.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
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

/** Sidebar-sized Markdown. Raw HTML is left as text; it is never a node of its own. */
export function parseChatMarkdown(source: string): ChatBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  return parseLines(lines);
}

function parseLines(lines: string[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
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
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const marks = heading[1] ?? '#';
      const level = Math.min(marks.length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ t: 'h', level, c: parseInlines(heading[2] ?? '') });
      i += 1;
      continue;
    }
    const list = matchList(line);
    if (list && list.indent === 0) {
      const parsed = parseList(lines, i);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const table = readTable(lines, i);
      blocks.push(table.block);
      i = table.next;
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

function parseList(lines: string[], start: number): { block: ChatBlock; next: number } {
  const first = matchList(lines[start] ?? '');
  if (!first) return { block: { t: 'ul', items: [] }, next: start + 1 };
  const ordered = first.kind === 'ol';
  const items: ChatItem[] = [];
  let i = start;
  while (i < lines.length) {
    const item = matchList(lines[i] ?? '');
    if (!item || item.indent > 0) break;
    if ((item.kind === 'ol') !== ordered) break;
    const text = item.text;
    i += 1;
    const children = parseLines([text]);
    items.push({ c: children.length > 0 ? children : [{ t: 'p', c: [] }] });
  }
  const block: ChatBlock = ordered ? { t: 'ol', start: first.n, items } : { t: 'ul', items };
  return { block, next: i };
}

function isStructural(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (matchFence(line) || HEADING_RE.test(line)) return true;
  const list = matchList(line);
  if (list && list.indent === 0) return true;
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
  const token = char === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${token}{${String(len)},}\\s*$`).test(line);
}

function matchList(
  line: string,
): { indent: number; kind: 'ul' | 'ol'; n: number; text: string } | null {
  const matched = LIST_RE.exec(line);
  if (!matched) return null;
  const number = matched[3];
  return {
    indent: (matched[1] ?? '').replace(/\t/g, '  ').length,
    kind: number ? 'ol' : 'ul',
    n: number ? Number(number) : 1,
    text: matched[4] ?? '',
  };
}

function isTableStart(lines: string[], index: number): boolean {
  const head = splitRow(lines[index] ?? '');
  const sep = splitRow(lines[index + 1] ?? '');
  if (!head || !sep || head.length < 2 || sep.length < 2) return false;
  return sep.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function readTable(lines: string[], index: number): { block: ChatBlock; next: number } {
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
  const rows: ChatInline[][][] = [];
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

function fitCells(cells: string[], width: number): ChatInline[][] {
  const out: ChatInline[][] = [];
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

function parseInlines(src: string): ChatInline[] {
  const out: ChatInline[] = [];
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
