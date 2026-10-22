import {
  CONVERSATION_MENTION_MAX,
  CONVERSATION_NODE_MAX,
  CONVERSATION_SELECTION_QUOTE_MAX,
  CONVERSATION_TITLE_MAX,
  type ConversationNodeKind,
  type ConversationNodeRef,
  type ConversationSelection,
} from '@inwit/dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clipChars(text: string, max: number): { text: string; clipped: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, clipped: false };
  return { text: `${chars.slice(0, max).join('')}…`, clipped: true };
}

export function conversationTitle(text: string, max = CONVERSATION_TITLE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return clipChars(flat, max).text.replace(/…$/, '');
}

/** Drop a half-open range and keep the quote inside the stored cap. */
export function normalizeConversationSelection(selection: ConversationSelection): ConversationSelection {
  const quote = [...selection.quote.trim()].slice(0, CONVERSATION_SELECTION_QUOTE_MAX).join('');
  const hasRange =
    selection.from != null && selection.to != null && selection.to > selection.from;
  return {
    documentId: selection.documentId,
    quote,
    ...(selection.blockIndex != null ? { blockIndex: selection.blockIndex } : {}),
    ...(hasRange ? { from: selection.from, to: selection.to } : {}),
    ...(selection.pageIndex != null ? { pageIndex: selection.pageIndex } : {}),
  };
}

export function normalizeDocumentIds(
  ids: readonly string[],
  max = CONVERSATION_MENTION_MAX,
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!UUID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export function mindNodeKey(documentId: string, nodeId: string): string {
  return `${documentId}:${nodeId}`;
}

/** First non-empty line, clipped by unicode scalar. Empty source uses the fallback. */
export function mindNodeLabel(text: string, fallback: string, max = 80): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  const chars = [...(line || fallback)];
  return chars.slice(0, max).join('');
}

export function normalizeNodeRefs(
  refs: readonly ConversationNodeRef[],
  max = CONVERSATION_NODE_MAX,
): ConversationNodeRef[] {
  const out: ConversationNodeRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = mindNodeKey(ref.documentId, ref.nodeId);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = mindNodeLabel(ref.label, '节点');
    if (!label) continue;
    out.push({ ...ref, label });
    if (out.length >= max) break;
  }
  return out;
}

export function clipReason(reason: string, max = 500): string {
  const trimmed = reason.trim() || '这次没有完成';
  return clipChars(trimmed, max).text;
}

export interface MindNodeFacts {
  documentId: string;
  nodeId: string;
  kind: ConversationNodeKind;
  label: string;
  missing: boolean;
  /** A rejected card can be read and cannot be edited. */
  rejected: boolean;
  concept: string;
  example: string;
  confusionPoint: string;
  questions: { question: string; answer: string }[];
  quote: string;
  note: string;
  text: string;
}

export function emptyMindNodeFacts(ref: ConversationNodeRef, missing = true): MindNodeFacts {
  return {
    documentId: ref.documentId,
    nodeId: ref.nodeId,
    kind: ref.kind,
    label: ref.label,
    missing,
    rejected: false,
    concept: '',
    example: '',
    confusionPoint: '',
    questions: [],
    quote: '',
    note: '',
    text: '',
  };
}
