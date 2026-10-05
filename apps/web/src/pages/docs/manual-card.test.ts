import { describe, expect, it, vi } from 'vitest';

const createCardMock = vi.fn();

vi.mock('@/api/cards', () => ({
  createCard: (...args: unknown[]) => createCardMock(...args),
}));

// refreshOne fires in the background after a successful create; keep it inert.
vi.mock('@/api/documents', () => ({
  getDocument: vi.fn().mockRejectedValue(new Error('no server in test')),
}));

import { DocsService } from './docs.service';

describe('addManualCard', () => {
  it('passes annotationId through so the server writes back convertedCardId', async () => {
    createCardMock.mockResolvedValue({
      id: 'card-1',
      documentId: 'a1000000-0000-4000-8000-000000000001',
      updatedAt: new Date().toISOString(),
    });
    const service = new DocsService();

    const ok = await service.addManualCard({
      documentId: 'a1000000-0000-4000-8000-000000000001',
      concept: '偏差',
      example: '偏离均值的程度',
      annotationId: 'a1000000-0000-4000-8000-000000000002',
    });

    expect(ok).toBe(true);
    expect(createCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ annotationId: 'a1000000-0000-4000-8000-000000000002' }),
    );
  });

  it('omits annotationId for a plain manual card', async () => {
    createCardMock.mockResolvedValue({
      id: 'card-2',
      documentId: 'a1000000-0000-4000-8000-000000000001',
      updatedAt: new Date().toISOString(),
    });
    const service = new DocsService();

    const ok = await service.addManualCard({
      documentId: 'a1000000-0000-4000-8000-000000000001',
      concept: '方差',
      example: '偏差平方的均值',
    });

    expect(ok).toBe(true);
    expect(createCardMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ annotationId: expect.anything() }),
    );
  });
});
