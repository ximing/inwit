import { describe, expect, it } from 'vitest';
import { DocFindService } from './doc-find.service';

describe('DocFindService', () => {
  it('restores the query of the document that owned it', () => {
    const find = new DocFindService();
    find.adopt('doc-a');
    find.showFind('背包');
    find.setReplacement('递推');
    find.toggleCase();
    find.showReplace(null);

    find.adopt('doc-b');
    expect(find.open).toBe(false);
    expect(find.query).toBe('');
    expect(find.replacement).toBe('');
    expect(find.caseSensitive).toBe(false);

    find.adopt('doc-a');
    expect(find.open).toBe(true);
    expect(find.replaceOpen).toBe(true);
    expect(find.query).toBe('背包');
    expect(find.replacement).toBe('递推');
    expect(find.caseSensitive).toBe(true);

    find.adopt('doc-a');
    expect(find.query).toBe('背包');
  });
});
