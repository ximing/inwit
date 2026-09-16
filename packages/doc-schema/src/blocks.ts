import { inlineTextOf, loadPmDoc } from './pm.js';
import type { DocBlock, PmJson } from './types.js';

export function blocksFromPmJSON(doc: PmJson): DocBlock[] {
  const pm = loadPmDoc(doc);
  const blocks: DocBlock[] = [];
  let pageIndex = 1;
  pm.forEach((node, _pos, index) => {
    blocks.push({
      index: index + 1,
      pageIndex,
      text: node.type.name === 'pageBreak' ? '' : inlineTextOf(node),
    });
    if (node.type.name === 'pageBreak') pageIndex += 1;
  });
  return blocks;
}

export function pmJsonToText(doc: PmJson): string {
  const pm = loadPmDoc(doc);
  const parts: string[] = [];
  let pageIndex = 1;
  pm.forEach((node) => {
    if (node.type.name === 'pageBreak') {
      parts.push(`--- 第 ${pageIndex} 页 ---`);
      pageIndex += 1;
    } else {
      parts.push(inlineTextOf(node));
    }
  });
  return parts.join('\n\n');
}
