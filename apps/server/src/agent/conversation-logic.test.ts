import { describe, expect, it } from 'vitest';
import {
  buildConversationPrompt,
  conversationTitle,
  documentEditRefusal,
  editRefusalStatus,
  emptyMindNodeFacts,
  fallbackReply,
  formatMindNode,
  normalizeDocumentIds,
  normalizeNodeRefs,
  planMindNodeUpdate,
  wantsCards,
} from './conversation-logic.js';
import type { ConversationNodeRef } from '@inwit/dto';

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

describe('normalizeNodeRefs', () => {
  const node = (id: string, label = '梯度'): ConversationNodeRef => ({
    documentId: DOC,
    nodeId: id,
    kind: 'card',
    label,
  });

  it('drops duplicate nodes and stops at the cap', () => {
    const third = '33333333-3333-4333-8333-333333333333';
    expect(normalizeNodeRefs([node(OTHER), node(OTHER), node(third)], 1)).toEqual([
      node(OTHER),
    ]);
  });
});

describe('planMindNodeUpdate', () => {
  it('writes a card concept and leaves the example unless detail is set', () => {
    expect(planMindNodeUpdate({ kind: 'card', text: ' 新概念 ' })).toEqual({
      ok: true,
      kind: 'card',
      concept: '新概念',
    });
    expect(planMindNodeUpdate({ kind: 'card', text: '新概念', detail: ' 一个例子 ' })).toEqual({
      ok: true,
      kind: 'card',
      concept: '新概念',
      example: '一个例子',
    });
  });

  it('refuses an empty note, an image, and a concept that is too long', () => {
    expect(planMindNodeUpdate({ kind: 'annotation', text: '  ' })).toEqual({
      ok: false,
      reason: '内容是空的',
    });
    expect(planMindNodeUpdate({ kind: 'image', text: '说明' }).ok).toBe(false);
    expect(planMindNodeUpdate({ kind: 'card', text: '甲'.repeat(2001) }).ok).toBe(false);
    expect(planMindNodeUpdate({ kind: 'text', text: '一行' })).toEqual({
      ok: true,
      kind: 'text',
      text: '一行',
    });
  });
});

describe('formatMindNode', () => {
  it('includes the ids and the card body', () => {
    const text = formatMindNode({
      ...emptyMindNodeFacts({ documentId: DOC, nodeId: OTHER, kind: 'card', label: '梯度' }, false),
      concept: '梯度是方向',
      example: '下山',
    });
    expect(text).toContain(OTHER);
    expect(text).toContain('梯度是方向');
    expect(text).toContain('下山');
  });
});

describe('buildConversationPrompt', () => {
  it('names dirty documents and withholds cards unless asked', () => {
    const prompt = buildConversationPrompt({
      mentions: [{ id: DOC, title: '梯度' }],
      nodes: [],
      dirtyDocumentIds: [DOC],
      allowCards: false,
      earlier: [],
      latest: '把第二段改短一点',
    });
    expect(prompt).toContain(DOC);
    expect(prompt).toContain('不要调用 write_cards');
    expect(prompt).toContain('把第二段改短一点');
    expect(prompt).toContain('本轮没有加入脑图节点');
  });

  it('keeps an earlier node id so a later turn can edit it', () => {
    const prompt = buildConversationPrompt({
      mentions: [],
      nodes: [],
      dirtyDocumentIds: [],
      allowCards: false,
      earlier: [
        {
          role: 'user',
          content: '解释一下',
          nodes: [{ documentId: DOC, nodeId: OTHER, kind: 'annotation', label: '笔记' }],
        },
      ],
      latest: '把笔记改短',
    });
    expect(prompt).toContain(OTHER);
    expect(prompt).toContain('批注「笔记」');
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

  it('names a mind-map node write', () => {
    expect(
      fallbackReply([
        {
          type: 'update_mind_node',
          documentId: DOC,
          nodeId: OTHER,
          title: '梯度',
          status: 'applied',
        },
      ]),
    ).toBe('已更新节点「梯度」');
  });
});
