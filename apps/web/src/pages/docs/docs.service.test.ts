import { describe, expect, it } from 'vitest';
import { DocsService } from './docs.service';

describe('document anchor card selection', () => {
  it('collapses the previous cards when another anchor is clicked', () => {
    const service = new DocsService();
    service.openAnchors(['card-a']);
    service.openAnchors(['card-b']);

    expect(service.expandedCardIds).toEqual(['card-b']);
    expect(service.activeCardId).toBe('card-b');
    expect(service.scrollCardId).toBe('card-b');
  });

  it('replaces a card opened from the rail with all cards linked to the new anchor', () => {
    const service = new DocsService();
    service.toggleCard('card-a');
    service.openAnchors(['card-b', 'card-c', 'card-b']);

    expect(service.expandedCardIds).toEqual(['card-b', 'card-c']);
    expect(service.activeCardId).toBe('card-b');

    service.toggleCard('card-b');
    expect(service.expandedCardIds).toEqual([]);
    expect(service.activeCardId).toBeNull();
  });
});
