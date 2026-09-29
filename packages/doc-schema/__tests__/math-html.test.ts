import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  classifyLatexInput,
  findMathInText,
  isLikelyMath,
  normalizeMathHtml,
} from '../src/schema/math-html.js';

describe('isLikelyMath', () => {
  it('accepts tex and rejects currency and prose', () => {
    expect(isLikelyMath('E=mc^2')).toBe(true);
    expect(isLikelyMath('a + b')).toBe(true);
    expect(isLikelyMath('\\int_0^1 x\\,dx')).toBe(true);
    expect(isLikelyMath('100')).toBe(false);
    expect(isLikelyMath('100 and')).toBe(false);
    expect(isLikelyMath('hello world')).toBe(false);
    expect(isLikelyMath('')).toBe(false);
  });
});

describe('findMathInText', () => {
  it('finds inline, display, and tex delimiters', () => {
    expect(findMathInText('能量 $E=mc^2$ 守恒')).toEqual([
      { index: 3, length: 8, latex: 'E=mc^2', display: false },
    ]);
    expect(findMathInText('$$\\frac{a}{b}$$')).toEqual([
      { index: 0, length: 15, latex: '\\frac{a}{b}', display: true },
    ]);
    expect(findMathInText('\\(a+b\\) 和 \\[c+d\\]')).toEqual([
      { index: 0, length: 7, latex: 'a+b', display: false },
      { index: 10, length: 7, latex: 'c+d', display: true },
    ]);
  });

  it('leaves prices alone', () => {
    expect(findMathInText('售价 $100 和 $200')).toEqual([]);
    expect(findMathInText('$100 and $200')).toEqual([]);
  });
});

describe('classifyLatexInput', () => {
  it('treats a newline or $$ as a block', () => {
    expect(classifyLatexInput('E=mc^2')).toEqual({ kind: 'inline', latex: 'E=mc^2' });
    expect(classifyLatexInput('$E=mc^2$')).toEqual({ kind: 'inline', latex: 'E=mc^2' });
    expect(classifyLatexInput('$$\\frac{a}{b}$$')).toEqual({ kind: 'block', latex: '\\frac{a}{b}' });
    expect(classifyLatexInput('a\nb')).toEqual({ kind: 'block', latex: 'a\nb' });
    expect(classifyLatexInput('   ')).toBeNull();
  });
});

describe('normalizeMathHtml', () => {
  it('keeps ordinary html unchanged', () => {
    const html = '<p>没有公式</p>';
    expect(normalizeMathHtml(html)).toBe(html);
  });

  it('reads katex annotations', () => {
    const inline = katex.renderToString('E=mc^2');
    const block = katex.renderToString('\\int_0^1 x\\,dx', { displayMode: true });
    expect(normalizeMathHtml(`<p>见 ${inline}。</p>`)).toContain(
      'data-type="inline-math" data-latex="E=mc^2"',
    );
    expect(normalizeMathHtml(block)).toContain(
      'data-type="block-math" data-latex="\\int_0^1 x\\,dx"',
    );
    expect(normalizeMathHtml(block)).not.toContain('katex-html');
  });

  it('converts bare mathml and tex scripts', () => {
    const mathml =
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi><mo>+</mo><mi>b</mi></math>';
    expect(normalizeMathHtml(mathml)).toContain('data-latex="a + b"');
    expect(
      normalizeMathHtml('<script type="math/tex; mode=display">\\frac{a}{b}</script>'),
    ).toBe('<div data-type="block-math" data-latex="\\frac{a}{b}"></div>');
  });

  it('converts dollar delimiters and skips code', () => {
    expect(normalizeMathHtml('<p>能量 $E=mc^2$ 守恒</p>')).toBe(
      '<p>能量 <span data-type="inline-math" data-latex="E=mc^2"></span> 守恒</p>',
    );
    expect(normalizeMathHtml('<p>$$\\frac{a}{b}$$</p>')).toBe(
      '<p><div data-type="block-math" data-latex="\\frac{a}{b}"></div></p>',
    );
    expect(normalizeMathHtml('<pre><code>$E=mc^2$</code></pre>')).toBe(
      '<pre><code>$E=mc^2$</code></pre>',
    );
    expect(normalizeMathHtml('<p>售价 $100</p>')).toBe('<p>售价 $100</p>');
  });

  it('joins display fences split across paragraphs', () => {
    const html = '<p>$$</p><p>\\int_0^1 x\\,dx</p><p>$$</p>';
    expect(normalizeMathHtml(html)).toBe(
      '<div data-type="block-math" data-latex="\\int_0^1 x\\,dx"></div>',
    );
  });

  it('does not wrap an existing math node twice', () => {
    const html = '<span data-type="inline-math" data-latex="E=mc^2">$E=mc^2$</span>';
    expect(normalizeMathHtml(html)).toBe(html);
  });

  it('escapes quotes in latex attributes', () => {
    expect(normalizeMathHtml('<p>$a\\text{"b"}$</p>')).toContain('data-latex="a\\text{&quot;b&quot;}"');
  });
});
