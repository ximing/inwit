import {
  CONVERSATION_MENTION_MAX,
  CONVERSATION_TITLE_MAX,
  type ConversationAction,
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
  return `已写入 ${String(action.count)} 张卡片到《${action.title}》`;
}

export function fallbackReply(actions: readonly ConversationAction[]): string {
  if (actions.length === 0) return '';
  return actions.map(actionLine).join('\n');
}

export function buildConversationPrompt(input: {
  mentions: readonly { id: string; title: string }[];
  dirtyDocumentIds: readonly string[];
  allowCards: boolean;
  earlier: readonly { role: 'user' | 'assistant'; content: string }[];
  latest: string;
}): string {
  const mentionBlock =
    input.mentions.length > 0
      ? input.mentions.map((item) => `- ${item.title}（${item.id}）`).join('\n')
      : '（本轮没有 @ 文档）';
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
            return `${who}：${body.text}${body.clipped ? '（已截断）' : ''}`;
          })
          .join('\n\n');
  const latest = clipChars(input.latest.trim(), 8000);
  return `本轮 @ 到的文档：
${mentionBlock}

有未保存修改、不能写入的文档 id：
${dirty}

${cards}

之前的对话：
${history}

用户这次说：
${latest.text}${latest.clipped ? '（已截断）' : ''}`;
}
