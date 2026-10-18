import { describe, expect, it, vi } from 'vitest';
import type { DocsService } from '@/pages/docs/docs.service';
import { StudyLinkService } from './study-link.service';

describe('StudyLinkService', () => {
  it('restores the locate snapshot of the document that owned it', () => {
    const link = new StudyLinkService();
    const docs = {
      activeCardId: 'card-a',
      activeAnnotationId: 'ann-a',
      openAnchors: vi.fn(),
      openAnnotation: vi.fn(),
      closeHighlight: vi.fn(),
    };
    vi.spyOn(link, 'docs', 'get').mockReturnValue(docs as unknown as DocsService);
    link.retainDocument('doc-a');
    link.locateCard('card-target');
    expect(link.canReturn).toBe(true);

    link.retainDocument('doc-b');
    expect(link.canReturn).toBe(false);
    expect(docs.openAnchors).toHaveBeenCalledTimes(1);

    link.retainDocument('doc-a');
    expect(link.canReturn).toBe(true);
    expect(docs.openAnchors).toHaveBeenCalledTimes(1);
  });
});
