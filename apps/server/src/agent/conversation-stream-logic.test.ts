import { describe, expect, it } from 'vitest';
import {
  applyConversationStream,
  conversationStreamView,
  emptyConversationStream,
  readAssistantPieces,
  toolActivity,
} from './conversation-stream-logic.js';

describe('conversation stream', () => {
  it('shows thinking and text as they arrive, then keeps one copy after the turn ends', () => {
    let state = emptyConversationStream();
    state = applyConversationStream(state, { type: 'thinking_delta', delta: '先看' });
    state = applyConversationStream(state, { type: 'thinking_delta', delta: '定义' });
    expect(conversationStreamView(state).thinking).toBe('先看定义');
    state = applyConversationStream(state, { type: 'text_delta', delta: '温度' });
    state = applyConversationStream(state, { type: 'text_delta', delta: '是缩放因子。' });
    expect(conversationStreamView(state).content).toBe('温度是缩放因子。');
    state = applyConversationStream(state, {
      type: 'message_end',
      text: '温度是缩放因子。',
      thinking: '先看定义',
    });
    const view = conversationStreamView(state);
    expect(view.content).toBe('温度是缩放因子。');
    expect(view.thinking).toBe('先看定义');
  });

  it('keeps earlier turns when the next one starts', () => {
    let state = applyConversationStream(emptyConversationStream(), {
      type: 'message_end',
      text: '我先读一下。',
      thinking: '需要原文',
    });
    state = applyConversationStream(state, { type: 'tool_start', toolName: 'read_document' });
    expect(conversationStreamView(state).activity).toBe('正在阅读文档');
    state = applyConversationStream(state, { type: 'tool_end' });
    state = applyConversationStream(state, { type: 'text_delta', delta: '正文说 T 越大越平。' });
    const view = conversationStreamView(state);
    expect(view.content).toBe('我先读一下。\n\n正文说 T 越大越平。');
    expect(view.thinking).toBe('需要原文');
    expect(view.activity).toBeNull();
  });

  it('drops redacted thinking and names unknown tools generically', () => {
    expect(
      readAssistantPieces({
        content: [
          { type: 'thinking', thinking: 'secret', redacted: true },
          { type: 'thinking', thinking: '可见' },
          { type: 'text', text: '回答' },
        ],
      }),
    ).toEqual({ text: '回答', thinking: '可见' });
    expect(toolActivity('read_document')).toBe('正在阅读文档');
    expect(toolActivity('something_else')).toBe('正在调用工具');
  });
});
