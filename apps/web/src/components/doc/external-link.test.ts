import { describe, expect, it } from 'vitest';
import {
  externalLinkOpenHref,
  externalOpenUrl,
  mergeExternalLinkRanges,
  wantsExternalLinkOpen,
} from './external-link';

describe('externalOpenUrl', () => {
  it('accepts http(s) and protocol-relative urls', () => {
    expect(externalOpenUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(externalOpenUrl('  http://example.com ')).toBe('http://example.com/');
    expect(externalOpenUrl('//example.com/a')).toBe('https://example.com/a');
  });

  it('rejects in-app paths and non-http protocols', () => {
    expect(externalOpenUrl('/docs/abc')).toBeNull();
    expect(externalOpenUrl('#section')).toBeNull();
    expect(externalOpenUrl('javascript:alert(1)')).toBeNull();
    expect(externalOpenUrl('mailto:a@b.c')).toBeNull();
    expect(externalOpenUrl('http://')).toBeNull();
    expect(externalOpenUrl('')).toBeNull();
    expect(externalOpenUrl(null)).toBeNull();
    expect(externalOpenUrl('   ')).toBeNull();
  });
});

describe('wantsExternalLinkOpen', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, altKey: false };

  it('opens on command or ctrl click', () => {
    expect(wantsExternalLinkOpen({ ...plain, metaKey: true })).toBe(true);
    expect(wantsExternalLinkOpen({ ...plain, ctrlKey: true })).toBe(true);
    expect(externalLinkOpenHref('https://example.com/a', { ...plain, metaKey: true })).toBe(
      'https://example.com/a',
    );
  });

  it('ignores plain clicks, alt-clicks, and non-primary buttons', () => {
    expect(wantsExternalLinkOpen(plain)).toBe(false);
    expect(wantsExternalLinkOpen({ ...plain, metaKey: true, altKey: true })).toBe(false);
    expect(wantsExternalLinkOpen({ ...plain, metaKey: true, button: 2 })).toBe(false);
    expect(externalLinkOpenHref('/docs/abc', { ...plain, metaKey: true })).toBeNull();
    expect(externalLinkOpenHref('https://example.com', plain)).toBeNull();
  });
});

describe('mergeExternalLinkRanges', () => {
  it('merges adjacent parts of the same url and keeps separate links', () => {
    expect(
      mergeExternalLinkRanges([
        { from: 1, to: 3, href: 'https://a.test/' },
        { from: 3, to: 5, href: 'https://a.test/' },
        { from: 6, to: 8, href: 'https://a.test/' },
        { from: 8, to: 9, href: 'https://b.test/' },
        { from: 9, to: 10, href: null },
      ]),
    ).toEqual([
      { from: 1, to: 5, href: 'https://a.test/' },
      { from: 6, to: 8, href: 'https://a.test/' },
      { from: 8, to: 9, href: 'https://b.test/' },
    ]);
  });
});
