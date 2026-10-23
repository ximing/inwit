import { EMPTY_PM_DOC } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { jsonEqual } from '@/lib/pm-doc';
import {
  buildDocumentPatch,
  displayedPmJson,
  enginePmJson,
  normalizedTitle,
  titlesDiffer,
} from './editor-session';

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

  it('keeps formula or page-break JSON when a chat answer is present', () => {
    const formula = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'E=mc^2' } }] }],
    };
    const shown = displayedPmJson({ contentJson: formula, answer: '聊天回答' });
    expect(shown).toEqual(formula);
    expect(enginePmJson(null, { contentJson: formula, answer: '聊天回答' }, false)).toEqual(formula);
    expect(
      buildDocumentPatch({
        draftTitle: '笔记',
        lastSavedTitle: '笔记',
        draftJson: shown,
        lastSavedJson: formula,
      }),
    ).toBeNull();
    const block = {
      type: 'doc' as const,
      content: [{ type: 'blockMath', attrs: { latex: '\\frac{1}{2}' } }],
    };
    expect(displayedPmJson({ contentJson: block, answer: '回答' })).toEqual(block);
    const pages = {
      type: 'doc' as const,
      content: [{ type: 'pageBreak', attrs: { pageIndex: 1 } }],
    };
    expect(displayedPmJson({ contentJson: pages, answer: '回答' })).toEqual(pages);
    const emptyMath = {
      type: 'doc' as const,
      content: [{ type: 'inlineMath', attrs: { latex: '   ' } }],
    };
    expect(displayedPmJson({ contentJson: emptyMath, answer: '回答' })).toMatchObject({
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '回答' }] }],
    });
  });

  it('restores the unsaved draft instead of the saved body', () => {
    const saved = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '已保存' }] }],
    };
    const draft = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '草稿里的锚点' }] }],
    };
    const shown = enginePmJson(draft, { contentJson: saved }, false);
    expect(shown).toEqual(draft);
    if (shown) shown.content = [];
    expect(draft.content).toHaveLength(1);
    expect(enginePmJson(null, { contentJson: EMPTY_PM_DOC, answer: '回答' }, false)).toMatchObject({
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '回答' }] }],
    });
    expect(enginePmJson(EMPTY_PM_DOC, { contentJson: EMPTY_PM_DOC }, false)).toBeNull();
    expect(enginePmJson(EMPTY_PM_DOC, { contentJson: EMPTY_PM_DOC }, true)).toEqual(EMPTY_PM_DOC);
  });
});
