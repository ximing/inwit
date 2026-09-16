import type { PmJson } from './types.js';

export function thematicBreaksToPageBreaks(doc: PmJson): PmJson {
  const content = doc.content;
  if (!content) return { ...doc };
  let n = 0;
  const next = content.map((node) => {
    if (node.type !== 'thematicBreak') return node;
    n += 1;
    return { type: 'pageBreak', attrs: { pageIndex: n } };
  });
  return { ...doc, content: next };
}
