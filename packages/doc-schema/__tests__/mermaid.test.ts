import { describe, expect, it } from 'vitest';
import { mermaidSvgLooksUnsafe } from '../src/schema/mermaid.js';

describe('mermaidSvgLooksUnsafe', () => {
  it('rejects script, event handlers, and javascript urls', () => {
    expect(mermaidSvgLooksUnsafe('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(false);
    expect(mermaidSvgLooksUnsafe('<svg><script>alert(1)</script></svg>')).toBe(true);
    expect(mermaidSvgLooksUnsafe('<svg><rect onclick="alert(1)" /></svg>')).toBe(true);
    expect(mermaidSvgLooksUnsafe('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(true);
    expect(mermaidSvgLooksUnsafe('<svg><a href="https://example.com">x</a></svg>')).toBe(false);
  });
});
