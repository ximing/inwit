import { Node } from 'prosemirror-model';
import { getHeadlessSchema } from './schema/headless.js';
import type { PmJson } from './types.js';

const SKIP_TEXT_NODES = new Set(['image', 'video', 'pageBreak']);

export function loadPmDoc(doc: PmJson): Node {
  return Node.fromJSON(getHeadlessSchema(), doc);
}

export function inlineTextOf(node: Node): string {
  if (node.type.name === 'pageBreak') return '';
  let out = '';
  node.descendants((child) => {
    if (child.isText) {
      out += child.text ?? '';
      return false;
    }
    if (child.type.name === 'hardBreak') {
      out += '\n';
      return false;
    }
    if (SKIP_TEXT_NODES.has(child.type.name)) return false;
    return true;
  });
  return out;
}

export type TextPiece = {
  textStart: number;
  textEnd: number;
  pmFrom: number;
  pmTo: number;
};

export function textPiecesOf(block: Node, blockPos: number): TextPiece[] {
  const pieces: TextPiece[] = [];
  let textOffset = 0;
  block.descendants((node, pos) => {
    const abs = blockPos + 1 + pos;
    if (node.isText && node.text) {
      const len = node.text.length;
      pieces.push({
        textStart: textOffset,
        textEnd: textOffset + len,
        pmFrom: abs,
        pmTo: abs + len,
      });
      textOffset += len;
      return false;
    }
    if (node.type.name === 'hardBreak') {
      pieces.push({
        textStart: textOffset,
        textEnd: textOffset + 1,
        pmFrom: abs,
        pmTo: abs + 1,
      });
      textOffset += 1;
      return false;
    }
    if (SKIP_TEXT_NODES.has(node.type.name)) return false;
    return true;
  });
  return pieces;
}

export function mapTextSpanToPm(
  pieces: TextPiece[],
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (start >= end) return null;
  let from: number | undefined;
  let to: number | undefined;
  for (const piece of pieces) {
    if (from === undefined && start >= piece.textStart && start < piece.textEnd) {
      from = piece.pmFrom + (start - piece.textStart);
    }
    if (end > piece.textStart && end <= piece.textEnd) {
      to = piece.pmFrom + (end - piece.textStart);
    }
  }
  if (from === undefined || to === undefined) return null;
  return { from, to };
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}
