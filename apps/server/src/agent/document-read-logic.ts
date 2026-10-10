import type { DocBlock } from '@inwit/doc-schema';
import { formatNumberedBlockView } from './card-anchor-logic.js';

/** 对话读正文时一次放进上下文的上限。按整块截止，不在句子中间切开。 */
export const DOCUMENT_READ_MAX_CHARS = 12_000;

/** 未读页目录里，每页开头保留的字数。这句只用于定位，不能当划线引文。 */
export const UNREAD_PAGE_LINE_CHARS = 40;

/** 一次返回的未读页条数。其余页用下一次 fromBlock 再列。 */
export const UNREAD_PAGE_LIMIT = 80;

export type UnreadPage = {
  page: number;
  blockIndex: number;
  line: string;
};

export type DocumentReadSlice = {
  text: string;
  fromBlock: number;
  throughBlock: number | null;
  nextBlock: number | null;
  blockCount: number;
  truncated: boolean;
  unreadPages: UnreadPage[];
  unreadPageCount: number;
};

function scalarLen(text: string): number {
  return [...text].length;
}

function clipLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars.slice(0, max).join('')}…`;
}

/**
 * 从 fromBlock 起拼编号正文，满额时停在下一块之前。
 * 窗口里的第一块即使本身超过上限也整块返回，否则这一块永远读不到。
 * unreadPages 列出窗口之后还没读完的页。整页未读时 blockIndex 是该页第一块；
 * 本页只读了一部分时，blockIndex 是下一块。已经跳过的前页不列出。
 */
export function sliceNumberedDocument(
  blocks: readonly DocBlock[],
  options?: { fromBlock?: number; maxChars?: number },
): DocumentReadSlice {
  const maxChars = options?.maxChars ?? DOCUMENT_READ_MAX_CHARS;
  const requested = options?.fromBlock ?? 1;
  const fromBlock = Number.isInteger(requested) && requested >= 1 ? requested : 1;
  const startAt = blocks.findIndex((block) => block.index >= fromBlock);
  const lines: string[] = [];
  let used = 0;
  let lastIndex = -1;
  let nextAt = -1;

  if (startAt >= 0) {
    for (let i = startAt; i < blocks.length; i += 1) {
      const block = blocks[i]!;
      const line = formatNumberedBlockView([block]);
      const addition = lines.length === 0 ? scalarLen(line) : scalarLen(line) + 1;
      if (lines.length > 0 && used + addition > maxChars) {
        nextAt = i;
        break;
      }
      lines.push(line);
      used += addition;
      lastIndex = i;
      if (used >= maxChars && i + 1 < blocks.length) {
        nextAt = i + 1;
        break;
      }
    }
  }

  const throughBlock = lastIndex >= 0 ? blocks[lastIndex]!.index : null;
  const nextBlock = nextAt >= 0 ? blocks[nextAt]!.index : null;
  const unread = throughBlock === null ? [] : unreadPagesAfter(blocks, throughBlock);
  return {
    text: lines.join('\n'),
    fromBlock,
    throughBlock,
    nextBlock,
    blockCount: blocks.length,
    truncated: nextBlock !== null,
    unreadPages: unread.slice(0, UNREAD_PAGE_LIMIT),
    unreadPageCount: unread.length,
  };
}

function unreadPagesAfter(blocks: readonly DocBlock[], throughBlock: number): UnreadPage[] {
  const pages = new Map<number, DocBlock[]>();
  for (const block of blocks) {
    const list = pages.get(block.pageIndex) ?? [];
    list.push(block);
    pages.set(block.pageIndex, list);
  }
  const out: UnreadPage[] = [];
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const pending = pages.get(page)!.filter((block) => block.index > throughBlock);
    if (pending.length === 0) continue;
    const start = pending[0]!;
    const source = pending.find((block) => block.text.trim().length > 0);
    out.push({
      page,
      blockIndex: start.index,
      line: source ? clipLine(source.text, UNREAD_PAGE_LINE_CHARS) : '',
    });
  }
  return out;
}
