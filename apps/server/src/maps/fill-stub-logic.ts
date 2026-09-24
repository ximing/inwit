import { markdownToContentJson } from '../documents/content-json.js';

/** Body inserted by enqueueFillMapNodeJob. Compared again with the node's current title. */
export function fillStubMarkdown(nodeTitle: string): string {
  return `# 入门：${nodeTitle}\n\n（待生成）`;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!deepEqualJson(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Untouched fill placeholder. A renamed node or any edit fails the content check
 * so processFill marks the document failed instead of deleting the user's text.
 */
export function isPristineFillStub(input: {
  status: string;
  source: string;
  deletedAt: Date | string | null;
  cardCount: number;
  annotationCount: number;
  contentJson: unknown;
  nodeTitle: string;
}): boolean {
  if (input.status !== 'pending') return false;
  if (input.source !== 'editor') return false;
  if (input.deletedAt != null) return false;
  if (input.cardCount !== 0 || input.annotationCount !== 0) return false;
  const expected = markdownToContentJson(fillStubMarkdown(input.nodeTitle));
  return deepEqualJson(input.contentJson, expected);
}