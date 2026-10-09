import {
  CONVERSATION_MENTION_MAX,
  CONVERSATION_NODE_KIND_LABELS,
  CONVERSATION_NODE_MAX,
  CONVERSATION_TITLE_MAX,
  mindEditSummary,
  type ConversationAction,
  type ConversationNodeKind,
  type ConversationNodeRef,
} from '@inwit/dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CARD_INTENT =
  /做成卡片|生成卡片|写(?:成|几张|一些)?卡|切卡|出(?:几张)?卡|整理成卡/;

export type DocumentEditRefusal = 'missing' | 'pdf' | 'report' | 'dirty' | 'empty';

export function clipChars(text: string, max: number): { text: string; clipped: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, clipped: false };
  return { text: `${chars.slice(0, max).join('')}…`, clipped: true };
}

export function conversationTitle(text: string, max = CONVERSATION_TITLE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return clipChars(flat, max).text.replace(/…$/, '');
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

/** 本轮可以改脑图的文档：@ 到的，以及本轮加入的节点所属的。 */
export function mindDocumentIds(
  mentions: readonly { id: string }[],
  nodes: readonly { documentId: string }[],
): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const mention of mentions) push(mention.id);
  for (const node of nodes) push(node.documentId);
  return out;
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

function clipField(text: string, max: number): string {
  const clipped = clipChars(text.trim(), max);
  if (!clipped.text) return '';
  return clipped.clipped ? `${clipped.text}（已截断）` : clipped.text;
}

/** Prompt block for one attached mind-map node. Ids stay so a later turn can edit it. */
export function formatMindNode(node: MindNodeFacts): string {
  const kind = CONVERSATION_NODE_KIND_LABELS[node.kind];
  const head = `${kind}「${node.label}」（节点 ${node.nodeId}，文档 ${node.documentId}）`;
  if (node.missing) return `${head}\n找不到了，不能再改。`;
  if (node.kind === 'card') {
    const shown = node.questions.slice(0, 6).map((item, index) => {
      return `${String(index + 1)}. ${clipField(item.question, 300)} / ${clipField(item.answer, 300)}`;
    });
    const rest =
      node.questions.length > 6
        ? `\n还有 ${String(node.questions.length - 6)} 道题没有列在这里。`
        : '';
    const locked = node.rejected ? '\n这张卡已经丢弃，只能阅读，不能修改。' : '';
    const questions = shown.length > 0 ? `题目：\n${shown.join('\n')}${rest}` : '题目：（没有）';
    return [
      head,
      `概念：${clipField(node.concept, 1500) || '（无）'}`,
      `例子：${clipField(node.example, 800) || '（无）'}`,
      `易混：${clipField(node.confusionPoint, 800) || '（无）'}`,
      questions,
    ].join('\n') + locked;
  }
  if (node.kind === 'annotation') {
    return `${head}\n引文：${clipField(node.quote, 1500) || '（无）'}\n笔记：${clipField(node.note, 1500) || '（无）'}`;
  }
  if (node.kind === 'text') return `${head}\n文字：${clipField(node.text, 1500) || '（无）'}`;
  return `${head}\n这是图片节点。这里读不到图片内容，也不能改文字。`;
}

const MIND_CARD_CONCEPT_MAX = 2000;
const MIND_CARD_EXAMPLE_MAX = 4000;
const MIND_NOTE_MAX = 20_000;
const MIND_TEXT_MAX = 4000;

export type MindNodeUpdatePlan =
  | { ok: true; kind: 'card'; concept: string; example?: string }
  | { ok: true; kind: 'annotation'; note: string }
  | { ok: true; kind: 'text'; text: string }
  | { ok: false; reason: string };

function scalarLen(text: string): number {
  return [...text].length;
}

/**
 * What update_mind_node is allowed to write.
 * Cards change the concept, and the example only when detail is passed.
 * Annotations change the note and leave the quote. Images cannot be edited.
 */
export function planMindNodeUpdate(input: {
  kind: ConversationNodeKind;
  text: string;
  detail?: string;
}): MindNodeUpdatePlan {
  if (input.kind === 'image') return { ok: false, reason: '图片节点不能改文字' };
  const text = input.text.trim();
  if (!text) return { ok: false, reason: '内容是空的' };
  if (input.kind === 'annotation') {
    if (scalarLen(text) > MIND_NOTE_MAX) return { ok: false, reason: `笔记最多 ${String(MIND_NOTE_MAX)} 字` };
    return { ok: true, kind: 'annotation', note: text };
  }
  if (input.kind === 'text') {
    if (scalarLen(text) > MIND_TEXT_MAX) return { ok: false, reason: `文本节点最多 ${String(MIND_TEXT_MAX)} 字` };
    return { ok: true, kind: 'text', text };
  }
  if (scalarLen(text) > MIND_CARD_CONCEPT_MAX) {
    return { ok: false, reason: `卡片概念最多 ${String(MIND_CARD_CONCEPT_MAX)} 字` };
  }
  if (input.detail === undefined) return { ok: true, kind: 'card', concept: text };
  const example = input.detail.trim();
  if (scalarLen(example) > MIND_CARD_EXAMPLE_MAX) {
    return { ok: false, reason: `卡片例子最多 ${String(MIND_CARD_EXAMPLE_MAX)} 字` };
  }
  return { ok: true, kind: 'card', concept: text, example };
}

/** Cards are written only when this message asks for them. */
export function wantsCards(text: string): boolean {
  return CARD_INTENT.test(text);
}

export function documentEditRefusal(input: {
  found: boolean;
  fileMime: string | null;
  kind: string;
  dirty: boolean;
  markdown: string;
}): DocumentEditRefusal | null {
  if (!input.found) return 'missing';
  if (input.fileMime === 'application/pdf') return 'pdf';
  if (input.kind === 'weekly_report') return 'report';
  if (input.dirty) return 'dirty';
  if (input.markdown.trim().length === 0) return 'empty';
  return null;
}

export function editRefusalReason(reason: DocumentEditRefusal): string {
  switch (reason) {
    case 'missing':
      return '找不到这篇文档';
    case 'pdf':
      return 'PDF 文件本身不能改，只能根据抽出的文字回答';
    case 'report':
      return '周报不在这里改';
    case 'dirty':
      return '有未保存的修改，这次没有写入';
    case 'empty':
      return '正文是空的';
  }
}

export function editRefusalStatus(
  reason: DocumentEditRefusal,
): 'blocked_dirty' | 'rejected' {
  return reason === 'dirty' ? 'blocked_dirty' : 'rejected';
}

export function clipReason(reason: string, max = 500): string {
  const trimmed = reason.trim() || '这次没有完成';
  return clipChars(trimmed, max).text;
}

function actionLine(action: ConversationAction): string {
  if (action.type === 'update_document') {
    if (action.status === 'applied') return `已更新《${action.title}》`;
    if (action.status === 'blocked_dirty') {
      return `《${action.title}》有未保存的修改，这次没有写入`;
    }
    return `没能修改《${action.title}》${action.reason ? `：${action.reason}` : ''}`;
  }
  if (action.type === 'create_document') return `已新建《${action.title}》`;
  if (action.type === 'update_mind_node') {
    if (action.status === 'applied') return `已更新节点「${action.title}」`;
    return `没能修改节点「${action.title}」${action.reason ? `：${action.reason}` : ''}`;
  }
  if (action.type === 'apply_mind_edits') return mindEditSummary(action);
  return `已写入 ${String(action.count)} 张卡片到《${action.title}》`;
}

export function fallbackReply(actions: readonly ConversationAction[]): string {
  if (actions.length === 0) return '';
  return actions.map(actionLine).join('\n');
}

export function buildConversationPrompt(input: {
  mentions: readonly { id: string; title: string }[];
  nodes: readonly MindNodeFacts[];
  dirtyDocumentIds: readonly string[];
  allowCards: boolean;
  earlier: readonly {
    role: 'user' | 'assistant';
    content: string;
    nodes?: readonly ConversationNodeRef[];
  }[];
  latest: string;
}): string {
  const mentionBlock =
    input.mentions.length > 0
      ? input.mentions.map((item) => `- ${item.title}（${item.id}）`).join('\n')
      : '（本轮没有 @ 文档）';
  const nodeBlock =
    input.nodes.length > 0
      ? input.nodes.map((node) => formatMindNode(node)).join('\n\n')
      : '（本轮没有加入脑图节点）';
  const mindIds = mindDocumentIds(input.mentions, input.nodes);
  const mindBlock =
    mindIds.length > 0
      ? mindIds.map((id) => `- ${id}`).join('\n')
      : '（本轮没有点名文档，不要调用 read_document_mind 或 apply_mind_edits）';
  const dirty =
    input.dirtyDocumentIds.length > 0 ? input.dirtyDocumentIds.join('、') : '（无）';
  const cards = input.allowCards
    ? '用户这次明确要求生成卡片，可以 write_cards。'
    : '用户这次没有要求生成卡片，不要调用 write_cards。';
  const earlier = input.earlier.slice(-20);
  const history =
    earlier.length === 0
      ? '（没有更早的对话）'
      : earlier
          .map((message) => {
            const who = message.role === 'user' ? '用户' : '助手';
            const body = clipChars(message.content.trim(), 1500);
            const attached = (message.nodes ?? [])
              .map(
                (node) =>
                  `${CONVERSATION_NODE_KIND_LABELS[node.kind]}「${node.label}」 ${node.nodeId}`,
              )
              .join('、');
            const nodeLine = attached ? `\n（加入的节点：${attached}）` : '';
            return `${who}：${body.text}${body.clipped ? '（已截断）' : ''}${nodeLine}`;
          })
          .join('\n\n');
  const latest = clipChars(input.latest.trim(), 8000);
  return `本轮 @ 到的文档：
${mentionBlock}

本轮加入的脑图节点：
${nodeBlock}

本轮可以调整脑图的文档：
${mindBlock}

有未保存修改、不能写入的文档 id：
${dirty}

${cards}

之前的对话：
${history}

用户这次说：
${latest.text}${latest.clipped ? '（已截断）' : ''}`;
}
