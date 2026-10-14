import { describe, expect, it } from 'vitest';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown } from '../src/pipeline.js';

describe('mermaid fences', () => {
  it('keeps a mermaid fence as a code block', () => {
    const md = '```mermaid\ngraph TD\n  A-->B\n```\n';
    const pm = parseMarkdownToPmJSON(md);
    expect(pm.content?.[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
      content: [{ type: 'text', text: 'graph TD\n  A-->B' }],
    });
    expect(serializePmJSONToMarkdown(pm)).toBe(md);
  });

  it('keeps an mmd fence alias', () => {
    const md = '```mmd\ngraph LR\n  A-->B\n```\n';
    const pm = parseMarkdownToPmJSON(md);
    expect(pm.content?.[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'mmd' },
    });
    expect(serializePmJSONToMarkdown(pm)).toBe(md);
  });
});
