import { describe, expect, it } from 'vitest';
import { parseMarkdownToPmJSON, serializePmJSONToMarkdown } from '../src/pipeline.js';

describe('math markdown', () => {
  it('round-trips inline and display math', () => {
    const md = '能量 $E=mc^2$ 守恒。\n\n$$\n\\int_0^1 x\\,dx\n$$\n';
    const pm = parseMarkdownToPmJSON(md);
    const inline = pm.content?.flatMap((block) => block.content ?? []).find((node) => node.type === 'inlineMath');
    expect(inline).toMatchObject({ type: 'inlineMath', attrs: { latex: 'E=mc^2' } });
    const block = pm.content?.find((node) => node.type === 'blockMath');
    expect(block).toMatchObject({ type: 'blockMath', attrs: { latex: '\\int_0^1 x\\,dx' } });
    expect(serializePmJSONToMarkdown(pm)).toBe(md);
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON(serializePmJSONToMarkdown(pm)))).toBe(md);
  });

  it('keeps a price as text and escapes the dollar on the way out', () => {
    const pm = parseMarkdownToPmJSON('售价 $100。\n');
    expect(JSON.stringify(pm)).not.toContain('inlineMath');
    expect(serializePmJSONToMarkdown(pm)).toBe('售价 \\$100。\n');
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON('售价 \\$100。\n'))).toBe('售价 \\$100。\n');
  });
});
