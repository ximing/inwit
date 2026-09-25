import { EMPTY_PM_DOC } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { jsonEqual } from '@/lib/pm-doc';
import { buildDocumentPatch, displayedPmJson, normalizedTitle, titlesDiffer } from './editor-session';

describe('editor session patch', () => {
  it('sends only a cleared title or only the body', () => {
    expect(normalizedTitle('  ')).toBeNull();
    expect(titlesDiffer('  ', '')).toBe(false);
    const body = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
    expect(
      buildDocumentPatch({
        draftTitle: '  ',
        lastSavedTitle: '笔记',
        draftJson: body,
        lastSavedJson: body,
      }),
    ).toEqual({ title: null });
    const next = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] };
    expect(
      buildDocumentPatch({
        draftTitle: '笔记',
        lastSavedTitle: '笔记',
        draftJson: next,
        lastSavedJson: body,
      }),
    ).toEqual({ contentJson: next });
    expect(
      buildDocumentPatch({
        draftTitle: '笔记',
        lastSavedTitle: ' 笔记 ',
        draftJson: body,
        lastSavedJson: body,
      }),
    ).toBeNull();
    const client = { type: 'doc' as const, content: [{ type: 'text', text: 'a' }] };
    const fromDb = { type: 'doc' as const, content: [{ text: 'a', type: 'text' }] };
    expect(jsonEqual(client, fromDb)).toBe(true);
    expect(
      buildDocumentPatch({
        draftTitle: '笔记',
        lastSavedTitle: '笔记',
        draftJson: client,
        lastSavedJson: fromDb,
      }),
    ).toBeNull();
  });

  it('shows a chat answer when the stored body is blank', () => {
    const fromAnswer = displayedPmJson({ contentJson: EMPTY_PM_DOC, answer: '第一段\n\n第二段' });
    const answerBlocks = (fromAnswer as { content?: unknown[] }).content;
    expect(answerBlocks).toHaveLength(2);
    expect(
      displayedPmJson({
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] },
        answer: '忽略',
      }),
    ).toMatchObject({
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }],
    });
  });
});
