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

  it('reads model display math \\[ \\boxed{} \\] and inline \\( \\)', () => {
    const boxed = '\\[ \\boxed{ 复杂任务的组织、依赖、并发、资源和失败管理 } \\]\n';
    const pm = parseMarkdownToPmJSON(boxed);
    expect(pm.content).toEqual([
      {
        type: 'blockMath',
        attrs: { latex: '\\boxed{ 复杂任务的组织、依赖、并发、资源和失败管理 }' },
      },
    ]);
    expect(parseMarkdownToPmJSON(serializePmJSONToMarkdown(pm))).toEqual(pm);

    const multiline = parseMarkdownToPmJSON('\\[\n\\boxed{a+b}\n\\]\n');
    expect(multiline.content?.[0]).toMatchObject({
      type: 'blockMath',
      attrs: { latex: '\\boxed{a+b}' },
    });

    const mixed = parseMarkdownToPmJSON('结论是 \\[ \\boxed{x^2} \\] 如上。\n\n行内 \\(E=mc^2\\) 结束。\n');
    expect(JSON.stringify(mixed)).toContain('"latex":"\\\\boxed{x^2}"');
    expect(JSON.stringify(mixed)).toContain('"latex":"E=mc^2"');
    expect(mixed.content?.some((node) => node.type === 'blockMath')).toBe(false);

    const fenced = parseMarkdownToPmJSON('```\n\\[ \\boxed{a} \\]\n```\n');
    expect(JSON.stringify(fenced)).not.toContain('blockMath');
    expect(JSON.stringify(fenced)).toContain('\\\\[ \\\\boxed{a} \\\\]');

    const literal = parseMarkdownToPmJSON('字面 \\\\[x\\\\]。\n');
    expect(JSON.stringify(literal)).not.toContain('Math');

    // A multiline formula that shares its lines with prose becomes its own
    // display block. The prose on those lines stays in the surrounding paragraphs.
    const wrapped = parseMarkdownToPmJSON('前文 \\[\n\\boxed{a}\n\\] 后文\n');
    expect(wrapped.content?.some((node) => node.type === 'blockMath' && node.attrs?.latex === '\\boxed{a}')).toBe(true);
    const wrappedText = JSON.stringify(wrapped);
    expect(wrappedText).toContain('前文');
    expect(wrappedText).toContain('后文');
    expect(wrappedText).not.toContain('"latex":"后文"');

    const chain = 'p(x_1,\\ldots,x_n)=\\prod_{i=1}^{n}p(x_i\\mid x_{<i})';
    const chained = parseMarkdownToPmJSON(`\\[\n${chain}\n\\]\n`);
    expect(chained.content?.[0]).toMatchObject({ type: 'blockMath', attrs: { latex: chain } });

    const loss = '\\mathcal L_{\\mathrm{AR}} = -\\sum_{i=1}^{N} \\log p_\\theta(z_i\\mid z_{<i},c)';
    const broken = parseMarkdownToPmJSON(`\\[ \\mathcal L_{\\mathrm{AR}} = -\\sum_{i=1}^{N} \\log p_\\theta(z_i\\mid\nz_{<i},c) \\]\n`);
    expect(broken.content?.[0]).toMatchObject({
      type: 'blockMath',
      attrs: { latex: loss.replace('\\mid ', '\\mid\n') },
    });
  });

  it('keeps a price as text and escapes the dollar on the way out', () => {
    const pm = parseMarkdownToPmJSON('售价 $100。\n');
    expect(JSON.stringify(pm)).not.toContain('inlineMath');
    expect(serializePmJSONToMarkdown(pm)).toBe('售价 \\$100。\n');
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON('售价 \\$100。\n'))).toBe('售价 \\$100。\n');
  });
});
