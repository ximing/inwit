import type { StorageFileView } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { fileIsArchived, filePrimaryLabel, fileRefHref, formatFileSize } from './files-view';

const DOC = '22222222-2222-4222-8222-222222222222';
const CARD = '33333333-3333-4333-8333-333333333333';

function file(partial: Partial<StorageFileView> & Pick<StorageFileView, 'kind' | 'refs'>): StorageFileView {
  return {
    key: 'docs/u/d/source.pdf',
    sizeBytes: 10,
    modifiedAt: null,
    ext: 'pdf',
    preview: null,
    previewUrl: null,
    unused: partial.refs.length === 0,
    ...partial,
  };
}

describe('formatFileSize', () => {
  it('uses a short unit', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(12 * 1024 * 1024)).toBe('12 MB');
  });
});

describe('file labels and links', () => {
  it('names a live document ahead of an archived one', () => {
    const item = file({
      kind: 'media',
      refs: [
        { type: 'document', id: DOC, title: '旧讲义', documentId: DOC, archived: true },
        {
          type: 'document',
          id: '22222222-2222-4222-8222-222222222223',
          title: '新讲义',
          documentId: '22222222-2222-4222-8222-222222222223',
          archived: false,
        },
      ],
    });
    expect(filePrimaryLabel(item)).toBe('新讲义');
    expect(fileIsArchived(item)).toBe(false);
  });

  it('marks a file archived only when every reference is in the trash', () => {
    const item = file({
      kind: 'source',
      refs: [{ type: 'document', id: DOC, title: '讲义', documentId: DOC, archived: true }],
    });
    expect(fileIsArchived(item)).toBe(true);
    expect(fileRefHref(item.refs[0]!)).toBeNull();
  });

  it('links a live card and leaves unused files unlabeled as trash', () => {
    const item = file({
      kind: 'excerpt',
      ext: 'png',
      refs: [{ type: 'card', id: CARD, title: '概念', documentId: DOC, archived: false }],
    });
    expect(filePrimaryLabel(item)).toBe('概念');
    expect(fileRefHref(item.refs[0]!)).toBe(`/docs?doc=${DOC}&anchor=${CARD}`);
    const orphan = file({ kind: 'avatar', ext: 'png', refs: [] });
    expect(filePrimaryLabel(orphan)).toBe('未使用的头像 · PNG');
    expect(fileIsArchived(orphan)).toBe(false);
  });
});
