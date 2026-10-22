import { describe, expect, it } from 'vitest';
import { linkDraftHref } from './reader-format-logic.js';

describe('linkDraftHref', () => {
  it('copies a string href only while the selection is a link', () => {
    expect(linkDraftHref({ link: true, href: 'https://inwit.example/a' })).toBe('https://inwit.example/a');
    expect(linkDraftHref({ link: true, href: '' })).toBe('');
  });

  it('uses an empty draft when there is no link or the href is not a string', () => {
    expect(linkDraftHref(null)).toBe('');
    expect(linkDraftHref({ link: false, href: 'https://inwit.example/a' })).toBe('');
    expect(linkDraftHref({ link: true })).toBe('');
    expect(linkDraftHref({ link: true, href: 12 })).toBe('');
  });
});
