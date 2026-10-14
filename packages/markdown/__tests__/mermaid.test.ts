import { describe, expect, it } from 'vitest';
import { markdownPasteBlocks } from '../src/paste.js';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown } from '../src/pipeline.js';

describe('mermaid fences', () => {
  it('turns a mermaid fence into a mermaid block', () => {
    const md = '```mermaid\ngraph TD\n  A-->B\n```\n';
    const pm = parseMarkdownToPmJSON(md);
    expect(pm.content?.[0]).toMatchObject({
      type: 'mermaid',
      attrs: { view: 'render' },
      content: [{ type: 'text', text: 'graph TD\n  A-->B' }],
    });
    expect(serializePmJSONToMarkdown(pm)).toBe(md);
  });

  it('turns an mmd fence into a mermaid block and writes it back as mermaid', () => {
    const md = '```mmd\ngraph LR\n  A-->B\n```\n';
    const pm = parseMarkdownToPmJSON(md);
    expect(pm.content?.[0]).toMatchObject({
      type: 'mermaid',
      attrs: { view: 'render' },
      content: [{ type: 'text', text: 'graph LR\n  A-->B' }],
    });
    expect(serializePmJSONToMarkdown(pm)).toBe('```mermaid\ngraph LR\n  A-->B\n```\n');
  });

  it('keeps the display mode out of the markdown fence', () => {
    const pm = {
      type: 'doc',
      content: [
        {
          type: 'mermaid',
          attrs: { view: 'split' },
          content: [{ type: 'text', text: 'graph TD\n  A-->B' }],
        },
      ],
    };
    expect(serializePmJSONToMarkdown(pm)).toBe('```mermaid\ngraph TD\n  A-->B\n```\n');
  });

  it('pastes a mermaid fence as a mermaid block', () => {
    expect(markdownPasteBlocks('```mermaid\ngraph TD\n  A-->B\n```')).toMatchObject([
      {
        type: 'mermaid',
        attrs: { view: 'render' },
        content: [{ type: 'text', text: 'graph TD\n  A-->B' }],
      },
    ]);
  });
});
