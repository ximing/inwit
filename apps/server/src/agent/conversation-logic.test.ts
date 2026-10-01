import { describe, expect, it } from 'vitest';
import {
  buildConversationPrompt,
  conversationTitle,
  documentEditRefusal,
  editRefusalStatus,
  fallbackReply,
  normalizeDocumentIds,
  wantsCards,
} from './conversation-logic.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('conversationTitle', () => {
  it('flattens whitespace and keeps a short phrase', () => {
    expect(conversationTitle('  这段\n在说什么  ')).toBe('这段 在说什么');
  });

  it('clips by unicode scalar, not by code unit', () => {
    expect(conversationTitle('甲'.repeat(30))).toBe('甲'.repeat(24));
  });
});

describe('normalizeDocumentIds', () => {
  it('drops invalid ids, duplicates, and extras past the cap', () => {
    expect(normalizeDocumentIds([DOC, 'nope', DOC, OTHER, OTHER], 2)).toEqual([DOC, OTHER]);
  });
});

describe('wantsCards', () => {
  it('is true only when the message asks for cards', () => {
    expect(wantsCards('把这段做成卡片')).toBe(true);
    expect(wantsCards('帮我切卡')).toBe(true);
    expect(wantsCards('这段什么意思')).toBe(false);
  });
});

describe('documentEditRefusal', () => {
  const open = {
    found: true,
    fileMime: null,
    kind: 'document',
    dirty: false,
    markdown: '改过的正文',
  };

  it('allows an ordinary clean document', () => {
    expect(documentEditRefusal(open)).toBeNull();
  });

  it('blocks pdf, weekly reports, dirty drafts, and empty markdown', () => {
    expect(documentEditRefusal({ ...open, fileMime: 'application/pdf' })).toBe('pdf');
    expect(documentEditRefusal({ ...open, kind: 'weekly_report' })).toBe('report');
    expect(documentEditRefusal({ ...open, dirty: true })).toBe('dirty');
    expect(documentEditRefusal({ ...open, markdown: '  ' })).toBe('empty');
    expect(documentEditRefusal({ ...open, found: false })).toBe('missing');
  });

  it('maps a dirty draft to blocked_dirty', () => {
    expect(editRefusalStatus('dirty')).toBe('blocked_dirty');
    expect(editRefusalStatus('pdf')).toBe('rejected');
  });
});

describe('buildConversationPrompt', () => {
  it('names dirty documents and withholds cards unless asked', () => {
    const prompt = buildConversationPrompt({
      mentions: [{ id: DOC, title: '梯度' }],
      dirtyDocumentIds: [DOC],
      allowCards: false,
      earlier: [],
      latest: '把第二段改短一点',
    });
    expect(prompt).toContain(DOC);
    expect(prompt).toContain('不要调用 write_cards');
    expect(prompt).toContain('把第二段改短一点');
  });
});

describe('fallbackReply', () => {
  it('explains a blocked write when the model stays silent', () => {
    expect(
      fallbackReply([
        {
          type: 'update_document',
          documentId: DOC,
          title: '梯度',
          status: 'blocked_dirty',
        },
      ]),
    ).toBe('《梯度》有未保存的修改，这次没有写入');
  });
});
