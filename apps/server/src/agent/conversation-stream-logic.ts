export interface ConversationStreamState {
  contentParts: string[];
  thinkingParts: string[];
  draftContent: string;
  draftThinking: string;
  activity: string | null;
}

export interface ConversationStreamView {
  content: string;
  thinking: string;
  activity: string | null;
}

export type ConversationStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'message_end'; text: string; thinking: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end' };

const TOOL_ACTIVITY: Record<string, string> = {
  read_document: '正在阅读文档',
  find_documents: '正在查找文档',
  update_document: '正在修改文档',
  create_document: '正在写新文档',
  write_cards: '正在写卡片',
  read_mind_node: '正在阅读节点',
  update_mind_node: '正在修改节点',
  search_cards: '正在检索卡片',
  search_user_memories: '正在检索记忆',
  search_memory_collections: '正在检索记忆',
  load_memory_collection: '正在读取记忆',
};

export function emptyConversationStream(): ConversationStreamState {
  return {
    contentParts: [],
    thinkingParts: [],
    draftContent: '',
    draftThinking: '',
    activity: null,
  };
}

export function toolActivity(toolName: string): string {
  return TOOL_ACTIVITY[toolName] ?? '正在调用工具';
}

/** Text and thinking from one assistant message. Redacted thinking is omitted. */
export function readAssistantPieces(message: { content: readonly unknown[] }): {
  text: string;
  thinking: string;
} {
  let text = '';
  let thinking = '';
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as { type?: unknown; text?: unknown; thinking?: unknown; redacted?: unknown };
    if (rec.type === 'text' && typeof rec.text === 'string') text += rec.text;
    else if (rec.type === 'thinking' && rec.redacted !== true && typeof rec.thinking === 'string') {
      thinking += rec.thinking;
    }
  }
  return { text: text.trim(), thinking: thinking.trim() };
}

function joinParts(parts: readonly string[], draft: string): string {
  const all = draft ? [...parts, draft] : parts;
  return all
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export function applyConversationStream(
  state: ConversationStreamState,
  event: ConversationStreamEvent,
): ConversationStreamState {
  switch (event.type) {
    case 'text_delta':
      return { ...state, draftContent: state.draftContent + event.delta };
    case 'thinking_delta':
      return { ...state, draftThinking: state.draftThinking + event.delta };
    case 'message_end':
      return {
        ...state,
        contentParts: event.text ? [...state.contentParts, event.text] : state.contentParts,
        thinkingParts: event.thinking ? [...state.thinkingParts, event.thinking] : state.thinkingParts,
        draftContent: '',
        draftThinking: '',
      };
    case 'tool_start':
      return { ...state, activity: toolActivity(event.toolName) };
    case 'tool_end':
      return { ...state, activity: null };
  }
}

export function conversationStreamView(state: ConversationStreamState): ConversationStreamView {
  return {
    content: joinParts(state.contentParts, state.draftContent),
    thinking: joinParts(state.thinkingParts, state.draftThinking),
    activity: state.activity,
  };
}
