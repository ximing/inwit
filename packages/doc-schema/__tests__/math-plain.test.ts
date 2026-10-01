import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mathPlainText } from '../src/schema/math-plain.js';

describe('mathPlainText', () => {
  it('wraps inline and block latex and ignores other nodes', () => {
    expect(mathPlainText('inlineMath', 'E=mc^2')).toBe('$E=mc^2$');
    expect(mathPlainText('blockMath', 'a+b')).toBe('$$\na+b\n$$');
    expect(mathPlainText('inlineMath', '  ')).toBe('');
    expect(mathPlainText('paragraph', 'E=mc^2')).toBeNull();
  });

  it('does not import the MathML converter', () => {
    const source = readFileSync(new URL('../src/schema/math-plain.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('mathml-to-latex');
    expect(source).not.toContain('math-html');
  });

  it('list titles import the plain helper, not math-html', () => {
    const source = readFileSync(
      new URL('../../dto/src/document-preview.ts', import.meta.url),
      'utf8',
    );
    const imports = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import '))
      .join('\n');
    expect(imports).toContain("from '@inwit/doc-schema/math-plain'");
    expect(imports).not.toContain('math-html');
    expect(imports).not.toContain('mathml-to-latex');
  });
});
