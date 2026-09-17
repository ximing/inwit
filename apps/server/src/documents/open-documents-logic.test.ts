import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { buildFinalMarkdown, checkOpenTokenRate, htmlToMarkdownViaTurndown, resetOpenTokenRate } from './open-documents-logic.js';

describe('htmlToMarkdownViaTurndown', () => {
  it('converts headings, paragraphs and emphasis', () => {
    const md = htmlToMarkdownViaTurndown(
      '<h1>标题</h1><p>hello <strong>world</strong> and <a href="https://a.b">link</a></p>',
    );
    expect(md).toContain('# 标题');
    expect(md).toContain('**world**');
    expect(md).toContain('[link](https://a.b)');
  });

  it('keeps images as markdown image syntax', () => {
    const md = htmlToMarkdownViaTurndown('<p><img src="https://x/img.png" alt="pic"></p>');
    expect(md).toContain('![pic](https://x/img.png)');
  });

  it('converts gfm tables and strikethrough', () => {
    const md = htmlToMarkdownViaTurndown(
      '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table><p><del>gone</del></p>',
    );
    expect(md).toContain('| a | b |');
    expect(md).toContain('~gone~');
  });

  it('drops script/style content', () => {
    const md = htmlToMarkdownViaTurndown(
      '<script>evil()</script><style>.x{}</style><p>visible</p>',
    );
    expect(md).not.toContain('evil');
    expect(md).toContain('visible');
  });

  it('throws IMPORT_EMPTY on blank html', () => {
    expect(() => htmlToMarkdownViaTurndown('<div>   </div>')).toThrowError(
      expect.objectContaining({ code: 'IMPORT_EMPTY' } as Partial<AppError>),
    );
  });
});

describe('buildFinalMarkdown', () => {
  it('prepends the attribution line with sourceUrl', () => {
    const md = buildFinalMarkdown('body', 'https://example.com/a(b)');
    expect(md.startsWith('> 原文：[原文链接](<https://example.com/a(b)>)\n\nbody')).toBe(true);
  });

  it('returns markdown unchanged without sourceUrl', () => {
    expect(buildFinalMarkdown('body')).toBe('body');
  });
});

describe('checkOpenTokenRate', () => {
  it('allows up to the limit then throws RATE_LIMITED', () => {
    resetOpenTokenRate();
    const now = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      checkOpenTokenRate('token-1', now);
    }
    expect(() => checkOpenTokenRate('token-1', now)).toThrowError(
      expect.objectContaining({ status: 429 } as Partial<AppError>),
    );
  });

  it('tracks tokens independently and expires the window', () => {
    resetOpenTokenRate();
    const now = 2_000_000;
    for (let i = 0; i < 30; i += 1) {
      checkOpenTokenRate('token-2', now);
    }
    expect(() => checkOpenTokenRate('token-3', now)).not.toThrow();
    const hourLater = now + 60 * 60 * 1000 + 1;
    expect(() => checkOpenTokenRate('token-2', hourLater)).not.toThrow();
  });
});
