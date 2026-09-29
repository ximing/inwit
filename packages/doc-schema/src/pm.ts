import { Node } from 'prosemirror-model';
import { getHeadlessSchema } from './schema/headless.js';
import { mathPlainText } from './schema/math-html.js';
import type { PmJson } from './types.js';

const SKIP_TEXT_NODES = new Set(['image', 'video', 'pageBreak']);

export function loadPmDoc(doc: PmJson): Node {
  return Node.fromJSON(getHeadlessSchema(), doc);
}

export function inlineTextOf(node: Node): string {
  if (node.type.name === 'pageBreak') return '';
  const own = mathText(node);
  if (own !== null) return own;
  let out = '';
  node.descendants((child) => {
    if (child.isText) {
      out += child.text ?? '';
      return false;
    }
    const leaf = mathText(child);
    if (leaf !== null) {
      out += leaf;
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
  /** Formula atoms: the text is LaTeX, the PM span is the whole node. */
  atom?: boolean;
};

function mathText(node: Node): string | null {
  const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
  return mathPlainText(node.type.name, latex);
}

export function textPiecesOf(block: Node, blockPos: number): TextPiece[] {
  const own = mathText(block);
  if (own !== null) {
    if (!own) return [];
    return [
      {
        textStart: 0,
        textEnd: own.length,
        pmFrom: blockPos,
        pmTo: blockPos + block.nodeSize,
        atom: true,
      },
    ];
  }
  const pieces: TextPiece[] = [];
  let textOffset = 0;
  block.descendants((node, pos) => {
    const abs = blockPos + 1 + pos;
    const leaf = mathText(node);
    if (leaf !== null) {
      if (leaf) {
        pieces.push({
          textStart: textOffset,
          textEnd: textOffset + leaf.length,
          pmFrom: abs,
          pmTo: abs + node.nodeSize,
          atom: true,
        });
        textOffset += leaf.length;
      }
      return false;
    }
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
    if (piece.atom) {
      if (from === undefined && start >= piece.textStart && start < piece.textEnd) {
        from = piece.pmFrom;
      }
      if (end > piece.textStart && end <= piece.textEnd) {
        to = piece.pmTo;
      }
      continue;
    }
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
