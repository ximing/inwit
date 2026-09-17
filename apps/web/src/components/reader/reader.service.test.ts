import { EMPTY_PM_DOC, type DocumentDetail } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';
import { getDocument } from '@/api/documents';
import { ReaderService } from './reader.service';

vi.mock('@/api/documents', () => ({ getDocument: vi.fn() }));

describe('PDF reading overlay', () => {
  it('opens a PDF document instead of rejecting it', async () => {
    const doc: DocumentDetail = {
      id: 'pdf-doc', userId: 'user', topicId: null, mapNodeId: null,
      title: 'PDF', description: null, contentJson: EMPTY_PM_DOC,
      source: 'import', status: 'digested', answer: null, linkHint: null,
      fileMime: 'application/pdf', pageCount: 2,
      createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
      cards: [], topicTitle: null,
    };
    vi.mocked(getDocument).mockResolvedValue(doc);
    const service = new ReaderService();

    await service.openDoc(doc.id);

    expect(service.doc?.id).toBe(doc.id);
    expect(service.error).toBeNull();
    expect(service.isOpen).toBe(true);
    service.close();
    expect(service.isOpen).toBe(false);
  });
});
