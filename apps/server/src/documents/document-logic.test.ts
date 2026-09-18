import { describe, expect, it } from 'vitest';
import { isBlankDocumentContent, planDigestOnSave } from './document-logic.js';

const IDLE_MS = 10 * 60 * 1000;

function para(text: string) {
  if (text.length === 0) return { type: 'doc' as const, content: [{ type: 'paragraph' }] };
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('isBlankDocumentContent', () => {
  it('treats empty, whitespace, and zero-width placeholders as blank', () => {
    expect(isBlankDocumentContent(para(''))).toBe(true);
    expect(isBlankDocumentContent(para('   \n\t'))).toBe(true);
    expect(isBlankDocumentContent(para('​'))).toBe(true);
    expect(isBlankDocumentContent(para(' ​ \n'))).toBe(true);
  });

  it('treats any visible text as content', () => {
    expect(isBlankDocumentContent(para('笔记'))).toBe(false);
    expect(isBlankDocumentContent(para('  a  '))).toBe(false);
    expect(
      isBlankDocumentContent({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }],
      }),
    ).toBe(false);
  });
});

describe('planDigestOnSave', () => {
  const blank = { contentJson: para('') };
  const filled = { contentJson: para('过拟合') };
  const base = {
    cardCount: 0,
    hasPendingDigest: false,
    hasRunningDigest: false,
    idleDelayMs: IDLE_MS,
    contentChanged: true,
  };

  it('never plans anything without a content patch or when cards exist', () => {
    expect(
      planDigestOnSave({ ...base, source: 'editor', existing: blank, input: {} }).kind,
    ).toBe('none');
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: blank,
        input: { contentJson: para('过拟合是什么') },
        cardCount: 1,
      }).kind,
    ).toBe('none');
  });

  it('enqueues a delayed digest when an editor document gains content', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: blank,
        input: { contentJson: para('过拟合是什么') },
      }),
    ).toEqual({ kind: 'enqueue', delayMs: IDLE_MS });
  });

  it('enqueues immediately when a pasted document gains content', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'paste',
        existing: blank,
        input: { contentJson: para('偏差与方差') },
      }),
    ).toEqual({ kind: 'enqueue', delayMs: 0 });
  });

  it('does not enqueue on blank-to-blank saves', () => {
    for (const source of ['editor', 'paste'] as const) {
      expect(
        planDigestOnSave({ ...base, source, existing: blank, input: { contentJson: para('') } })
          .kind,
      ).toBe('none');
    }
  });

  it('postpones instead of enqueueing when a digest is already pending', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: blank,
        input: { contentJson: para('过拟合是什么') },
        hasPendingDigest: true,
      }),
    ).toEqual({ kind: 'postpone', delayMs: IDLE_MS });
  });

  it('leaves a running digest alone', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: blank,
        input: { contentJson: para('过拟合是什么') },
        hasRunningDigest: true,
      }).kind,
    ).toBe('none');
  });

  it('postpones the pending digest while the user keeps writing', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: filled,
        input: { contentJson: para('补充一段') },
        hasPendingDigest: true,
      }),
    ).toEqual({ kind: 'postpone', delayMs: IDLE_MS });
  });

  it('does not postpone for non-editor sources or unchanged content', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'paste',
        existing: filled,
        input: { contentJson: para('补充一段') },
        hasPendingDigest: true,
      }).kind,
    ).toBe('none');
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: filled,
        input: { contentJson: para('过拟合') },
        hasPendingDigest: true,
        contentChanged: false,
      }).kind,
    ).toBe('none');
  });

  it('does not re-digest a document that already has content and no pending job', () => {
    expect(
      planDigestOnSave({
        ...base,
        source: 'editor',
        existing: filled,
        input: { contentJson: para('补充一段') },
      }).kind,
    ).toBe('none');
  });
});
