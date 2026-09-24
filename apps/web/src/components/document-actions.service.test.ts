import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PM_DOC, type DocumentListItem } from '@inwit/dto';
import { DocumentActionsService } from './document-actions.service';
import { deleteDocument, getDocument, retryDocument, updateDocument } from '@/api/documents';

vi.mock('@/api/documents', () => ({ updateDocument: vi.fn(), deleteDocument: vi.fn(), retryDocument: vi.fn(), getDocument: vi.fn() }));
const doc: DocumentListItem = {
  id: 'doc-1', userId: 'user-1', topicId: null, mapNodeId: null,
  title: '原名', description: null, contentJson: EMPTY_PM_DOC, source: 'editor',
  status: 'digested', failReason: null, answer: null, linkHint: null, fileMime: null,
  pageCount: null, createdAt: '', updatedAt: '', cardCount: 0, proposedCount: 0, topicTitle: null,
};

beforeEach(() => vi.clearAllMocks());
describe('document context actions', () => {
  it('keeps the rename dialog and original data on a failed request', async () => {
    const service = new DocumentActionsService();
    const changes: unknown[] = [];
    service.open(doc, 10, 20, (change) => changes.push(change), () => {});
    service.showDialog('rename');
    service.title = '新名';
    vi.mocked(updateDocument).mockRejectedValue(new Error('offline'));
    await service.submit();
    expect(service.dialog).toBe('rename');
    expect(service.error).toBeTruthy();
    expect(service.busy).toBe(false);
    expect(changes).toEqual([]);
  });
  it('rejects blank titles without closing the dialog', async () => {
    const service = new DocumentActionsService();
    service.open(doc, 0, 0, () => {}, () => {});
    service.showDialog('rename');
    service.title = '  ';
    await service.submit();
    expect(service.error).toBeTruthy();
    expect(service.dialog).toBe('rename');
  });
  it('does not notify deletion until it succeeds and ignores duplicate submits', async () => {
    const service = new DocumentActionsService();
    const changes: unknown[] = [];
    let finish!: () => void;
    vi.mocked(deleteDocument).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    service.open(doc, 0, 0, (change) => changes.push(change), () => {});
    service.showDialog('delete');
    const pending = service.submit();
    await service.submit();
    expect(changes).toEqual([]);
    expect(service.busy).toBe(true);
    finish();
    await pending;
    expect(changes).toEqual([{ id: 'doc-1', document: null, topicTitle: null }]);
    expect(service.dialog).toBeNull();
  });
  it('publishes the saved title only after the server accepts it', async () => {
    const service = new DocumentActionsService();
    let displayed = { ...doc };
    vi.mocked(updateDocument).mockImplementation(async (id, input) => {
      if (id !== doc.id || input.title !== '新名') throw new Error('incorrect rename request');
      return { ...doc, title: input.title };
    });
    service.open(doc, 0, 0, (change) => { displayed = { ...displayed, ...change.document }; }, () => {});
    service.showDialog('rename');
    service.title = '  新名  ';
    await service.submit();
    expect(displayed.title).toBe('新名');
    expect(service.dialog).toBeNull();
    expect(service.error).toBeNull();
  });

  it('can remove a document from its current topic', async () => {
    const service = new DocumentActionsService();
    const changes: unknown[] = [];
    vi.mocked(updateDocument).mockImplementation(async (id, input) => {
      if (id !== doc.id || input.topicId !== null) throw new Error('incorrect move request');
      return { ...doc, topicId: null };
    });
    service.open({ ...doc, topicId: 'topic-1', topicTitle: '主题' }, 0, 0, (change) => changes.push(change), () => {});
    service.dialog = 'move';
    service.topicsLoaded = true;
    service.topicId = '';
    await service.submit();
    expect(changes).toEqual([{ id: doc.id, document: doc, topicTitle: null }]);
    expect(service.dialog).toBeNull();
  });

  it('refreshes status after retry so the list can resume polling', async () => {
    const service = new DocumentActionsService();
    let displayed = { ...doc, status: 'failed' as DocumentListItem['status'] };
    vi.mocked(retryDocument).mockResolvedValue({
      id: 'job-1', userId: doc.userId, type: 'digest', status: 'pending',
      payload: { documentId: doc.id }, runAt: '', finishedAt: null, attempts: 0,
      lastError: null, createdAt: '', updatedAt: '', summary: '', description: '',
    });
    vi.mocked(getDocument).mockResolvedValue({ ...doc, status: 'pending', cards: [] });
    service.open(displayed, 0, 0, (change) => { displayed = { ...displayed, ...change.document }; }, () => {});
    service.showDialog('retry');
    await service.submit();
    expect(displayed.status).toBe('pending');
    expect(service.dialog).toBeNull();
  });

});
