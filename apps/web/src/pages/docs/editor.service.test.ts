import type { Document, DocumentDetail, PmDocJson } from '@inwit/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument, getDocument, updateDocument } from '@/api/documents';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';

vi.mock('@/api/documents', async (original) => ({
  ...(await original<typeof import('@/api/documents')>()),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  getDocument: vi.fn(),
}));

const USER = '11111111-1111-4111-8111-111111111111';
const ORIGINAL = '22222222-2222-4222-8222-222222222222';
const COPY = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';

function paragraph(text: string): PmDocJson {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function document(partial: Partial<Document> & Pick<Document, 'id' | 'contentJson'>): Document {
  return {
    userId: USER,
    topicId: null,
    mapNodeId: null,
    title: '标题',
    description: null,
    source: 'editor',
    status: 'digested',
    failReason: null,
    answer: null,
    linkHint: null,
    fileMime: null,
    pageCount: null,
    createdAt: '2026-10-19T14:55:00.000Z',
    updatedAt: '2026-10-19T14:55:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

function detail(id: string, contentJson: PmDocJson): DocumentDetail {
  return { ...document({ id, contentJson }), topicTitle: null, cards: [] };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function prime(editor: EditorService, json: PmDocJson = paragraph('原文')): void {
  editor.phase = 'ready';
  editor.id = ORIGINAL;
  editor.draftTitle = '标题';
  editor.lastSavedTitle = '标题';
  editor.draftJson = json;
  editor.lastSavedJson = json;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('EditorService autosave', () => {
  it('creates one document for a new note', async () => {
    vi.useFakeTimers();
    vi.mocked(createDocument).mockImplementation(async (input) =>
      document({
        id: COPY,
        contentJson: input.contentJson,
        title: input.title ?? null,
        topicId: input.topicId ?? null,
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    const editor = new EditorService();
    editor.initNew('55555555-5555-4555-8555-555555555555');
    editor.noteTitleChange('新笔记');
    editor.noteChange(paragraph('新的正文'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(createDocument).toHaveBeenCalledOnce();
    expect(updateDocument).not.toHaveBeenCalled();
    expect(editor.id).toBe(COPY);
    expect(editor.phase).toBe('ready');
    editor.destroy();
  });

  it('updates an open document', async () => {
    vi.mocked(updateDocument).mockImplementation(async (id, patch) =>
      document({
        id,
        contentJson: patch.contentJson ?? paragraph('原文'),
        title: patch.title === undefined ? '标题' : patch.title,
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    await editor.save();
    expect(updateDocument).toHaveBeenCalledWith(ORIGINAL, { contentJson: paragraph('改过') });
    expect(createDocument).not.toHaveBeenCalled();
    expect(editor.id).toBe(ORIGINAL);
    editor.destroy();
  });

  it('does not create a copy when the editor goes idle during an update', async () => {
    vi.useFakeTimers();
    const update = deferred<Document>();
    vi.mocked(updateDocument).mockReturnValue(update.promise);
    vi.mocked(createDocument).mockImplementation(async (input) =>
      document({ id: COPY, contentJson: input.contentJson, title: input.title ?? '标题' }),
    );
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    const saving = editor.save();
    expect(updateDocument).toHaveBeenCalledOnce();
    editor.idle();
    update.resolve(
      document({
        id: ORIGINAL,
        contentJson: paragraph('服务端另一份'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    await saving;
    await vi.advanceTimersByTimeAsync(2500);
    expect(createDocument).not.toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledOnce();
    expect(updateDocument).toHaveBeenCalledWith(ORIGINAL, { contentJson: paragraph('改过') });
    expect(editor.id).toBeNull();
    expect(editor.phase).toBe('idle');
    editor.destroy();
  });

  it('keeps later keystrokes on the same document', async () => {
    vi.useFakeTimers();
    const update = deferred<Document>();
    vi.mocked(updateDocument)
      .mockReturnValueOnce(update.promise)
      .mockImplementation(async (id, patch) =>
        document({
          id,
          contentJson: patch.contentJson ?? paragraph('第二稿'),
          updatedAt: '2026-10-19T15:00:02.000Z',
        }),
      );
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('第一稿'));
    const saving = editor.save();
    editor.noteChange(paragraph('第二稿'));
    update.resolve(
      document({
        id: ORIGINAL,
        contentJson: paragraph('第一稿'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    await saving;
    await vi.advanceTimersByTimeAsync(2000);
    expect(createDocument).not.toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updateDocument).mock.calls[1]?.[0]).toBe(ORIGINAL);
    expect(vi.mocked(updateDocument).mock.calls[1]?.[1]).toEqual({ contentJson: paragraph('第二稿') });
    editor.destroy();
  });

  it('does not save after the editor is idle', async () => {
    vi.useFakeTimers();
    const editor = new EditorService();
    prime(editor);
    editor.idle();
    editor.noteChange(paragraph('改过'));
    await editor.save();
    await vi.advanceTimersByTimeAsync(2500);
    expect(createDocument).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('does not apply an in-flight update onto the next document', async () => {
    const update = deferred<Document>();
    const next = deferred<DocumentDetail>();
    vi.mocked(updateDocument).mockReturnValue(update.promise);
    vi.mocked(getDocument).mockReturnValue(next.promise);
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    const saving = editor.save();
    const loading = editor.load(NEXT);
    update.resolve(
      document({
        id: ORIGINAL,
        contentJson: paragraph('服务端另一份'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    await saving;
    next.resolve(detail(NEXT, paragraph('下一篇')));
    await loading;
    expect(editor.id).toBe(NEXT);
    expect(editor.draftJson).toEqual(paragraph('下一篇'));
    expect(editor.lastSavedJson).toEqual(paragraph('下一篇'));
    expect(createDocument).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('waits for an in-flight save before leaving', async () => {
    const update = deferred<Document>();
    vi.mocked(updateDocument).mockReturnValue(update.promise);
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    const saving = editor.save();
    let settled = false;
    const leaving = editor.commitBeforeLeave().then((ok) => {
      settled = true;
      return ok;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(updateDocument).toHaveBeenCalledOnce();
    update.resolve(
      document({
        id: ORIGINAL,
        contentJson: paragraph('改过'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    await saving;
    await expect(leaving).resolves.toBe(true);
    expect(updateDocument).toHaveBeenCalledOnce();
    expect(editor.draftJson).toEqual(paragraph('改过'));
    expect(editor.saveState).toBe('saved');
    editor.destroy();
  });

  it('writes a debounced draft before the timer when leaving', async () => {
    vi.useFakeTimers();
    vi.mocked(updateDocument).mockImplementation(async (id, patch) =>
      document({
        id,
        contentJson: patch.contentJson ?? paragraph('改过'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    expect(editor.saveTimer).not.toBeNull();
    await expect(editor.commitBeforeLeave()).resolves.toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(ORIGINAL, { contentJson: paragraph('改过') });
    expect(editor.saveTimer).toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect(updateDocument).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it('saves a dirty draft before opening another document', async () => {
    vi.mocked(updateDocument).mockImplementation(async (id, patch) =>
      document({
        id,
        contentJson: patch.contentJson ?? paragraph('改过'),
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    vi.mocked(getDocument).mockResolvedValue(detail(NEXT, paragraph('下一篇')));
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    await editor.open(NEXT, null);
    expect(updateDocument).toHaveBeenCalledWith(ORIGINAL, { contentJson: paragraph('改过') });
    expect(getDocument).toHaveBeenCalledWith(NEXT);
    expect(editor.id).toBe(NEXT);
    expect(editor.draftJson).toEqual(paragraph('下一篇'));
    editor.destroy();
  });

  it('stays on the unsaved draft when opening another document fails to save', async () => {
    vi.mocked(updateDocument).mockRejectedValue(new Error('没存上'));
    vi.mocked(getDocument).mockResolvedValue(detail(NEXT, paragraph('下一篇')));
    const editor = new EditorService();
    const onSaved = vi.fn();
    editor.onSaved = onSaved;
    prime(editor);
    editor.noteChange(paragraph('改过'));
    await editor.open(NEXT, null);
    expect(getDocument).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(editor.id).toBe(ORIGINAL);
    expect(editor.phase).toBe('ready');
    expect(editor.saveState).toBe('error');
    expect(editor.draftJson).toEqual(paragraph('改过'));
    editor.destroy();
  });

  it('notes a saved draft on leave and does not note or idle when save fails', async () => {
    const docs = new DocsService();
    const editor = new EditorService();
    vi.spyOn(docs, 'resolve').mockImplementation(((token: unknown) => {
      if (token === EditorService) return editor;
      throw new Error('unexpected service');
    }) as typeof docs.resolve);
    const noted = vi.spyOn(docs, 'noteEditorSaved');
    editor.onSaved = (saved) => {
      docs.noteEditorSaved(saved.id, saved.title, saved.contentJson, saved.updatedAt);
    };
    prime(editor);
    editor.noteChange(paragraph('改过'));
    vi.mocked(updateDocument).mockRejectedValueOnce(new Error('没存上'));

    await expect(docs.commitEditorLeave(true)).resolves.toBe(false);
    expect(noted).not.toHaveBeenCalled();
    expect(editor.phase).toBe('ready');
    expect(editor.id).toBe(ORIGINAL);
    expect(editor.draftJson).toEqual(paragraph('改过'));

    vi.mocked(updateDocument).mockImplementation(async (id, patch) =>
      document({
        id,
        contentJson: patch.contentJson ?? paragraph('改过'),
        title: '标题',
        updatedAt: '2026-10-19T15:00:00.000Z',
      }),
    );
    await expect(docs.commitEditorLeave(true)).resolves.toBe(true);
    expect(noted).toHaveBeenCalledWith(
      ORIGINAL,
      '标题',
      paragraph('改过'),
      '2026-10-19T15:00:00.000Z',
    );
    expect(editor.phase).toBe('idle');
    editor.destroy();
  });

  it('returns false when the second leave save fails after the draft stays dirty', async () => {
    const editor = new EditorService();
    prime(editor);
    editor.noteChange(paragraph('改过'));
    vi.mocked(updateDocument)
      .mockImplementationOnce(async (id, patch) => {
        editor.noteChange(paragraph('还在改'));
        return document({
          id,
          contentJson: patch.contentJson ?? paragraph('改过'),
          updatedAt: '2026-10-19T15:00:00.000Z',
        });
      })
      .mockRejectedValueOnce(new Error('没存上'));

    await expect(editor.commitBeforeLeave()).resolves.toBe(false);

    expect(updateDocument).toHaveBeenNthCalledWith(1, ORIGINAL, {
      contentJson: paragraph('改过'),
    });
    expect(updateDocument).toHaveBeenNthCalledWith(2, ORIGINAL, {
      contentJson: paragraph('还在改'),
    });
    expect(editor.saveState).toBe('error');
    expect(editor.phase).toBe('ready');
    expect(editor.id).toBe(ORIGINAL);
    expect(editor.draftJson).toEqual(paragraph('还在改'));
    expect(editor.dirty).toBe(true);
    editor.destroy();
  });
});
