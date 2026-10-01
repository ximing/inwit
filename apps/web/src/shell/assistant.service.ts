import { Service } from '@rabjs/react';
import { CONVERSATION_MENTION_MAX, docDisplayTitle, type Conversation, type ConversationDetail } from '@inwit/dto';
import { getDocument } from '@/api/documents';
import { ApiError, errorMessage } from '@/api/client';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  retryConversationMessage,
  sendConversationMessage,
} from '@/api/conversations';
import { DialogService } from '@/services/dialog.service';
import { EditorPresenceService } from '@/services/editor-presence.service';

const STORAGE_KEY = 'inwit-assistant-conversation';
const POLL_MS = 400;

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

export class AssistantService extends Service {
  conversations: Conversation[] = [];
  current: ConversationDetail | null = null;
  historyOpen = false;
  error: string | null = null;
  contextDocId: string | null = null;
  contextDismissed = false;
  contextTitle: string | null = null;
  private listTicket = 0;
  private openTicket = 0;
  private contextTicket = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    const stored = readStored();
    void this.loadList();
    if (stored) void this.open(stored, true);
  }

  get busy(): boolean {
    return this.current?.messages.some((message) => message.status === 'pending') ?? false;
  }

  get needsAttention(): boolean {
    const last = this.current?.messages.at(-1);
    if (!last || last.role !== 'assistant') return false;
    return last.status === 'pending' || last.status === 'failed';
  }

  get contextChip(): { id: string; title: string } | null {
    if (!this.contextDocId || this.contextDismissed) return null;
    return { id: this.contextDocId, title: this.contextTitle ?? '当前文档' };
  }

  setContext(documentId: string | null): void {
    if (documentId === this.contextDocId) return;
    this.contextDocId = documentId;
    this.contextDismissed = false;
    this.contextTitle = null;
    if (documentId) void this.loadContextTitle(documentId);
  }

  dismissContext(): void {
    this.contextDismissed = true;
  }

  toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) void this.loadList();
  }

  startNew(): void {
    this.current = null;
    this.historyOpen = false;
    this.error = null;
    this.clearTimer();
    writeStored(null);
  }

  async loadList(): Promise<void> {
    const ticket = ++this.listTicket;
    try {
      const page = await listConversations();
      if (ticket !== this.listTicket) return;
      this.conversations = page.items;
    } catch (err) {
      if (ticket !== this.listTicket) return;
      if (this.conversations.length === 0) this.error = errorMessage(err, '对话列表没有加载出来');
    }
  }

  async open(id: string, quiet = false): Promise<void> {
    const ticket = ++this.openTicket;
    if (!quiet) this.error = null;
    try {
      const detail = await getConversation(id);
      if (ticket !== this.openTicket) return;
      this.current = detail;
      this.historyOpen = false;
      writeStored(detail.id);
      this.watch();
    } catch (err) {
      if (ticket !== this.openTicket) return;
      if (err instanceof ApiError && err.status === 404) {
        if (this.current?.id === id) this.current = null;
        if (readStored() === id) writeStored(null);
        return;
      }
      if (!quiet) this.error = errorMessage(err, '打不开这段对话');
    }
  }

  async send(text: string, documentIds: string[]): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return false;
    this.error = null;
    const ids = [...documentIds];
    const chip = this.contextChip;
    if (chip && !ids.includes(chip.id)) ids.push(chip.id);
    const input = {
      text: trimmed,
      documentIds: ids.slice(0, CONVERSATION_MENTION_MAX),
      dirtyDocumentIds: this.dirtyIds(),
    };
    try {
      const detail = this.current
        ? await sendConversationMessage(this.current.id, input)
        : await createConversation(input);
      this.current = detail;
      this.historyOpen = false;
      writeStored(detail.id);
      void this.loadList();
      this.watch();
      return true;
    } catch (err) {
      this.error = errorMessage(err, '没送出去');
      return false;
    }
  }

  async retry(messageId: string): Promise<void> {
    if (!this.current || this.busy) return;
    this.error = null;
    try {
      const detail = await retryConversationMessage(this.current.id, messageId, {
        dirtyDocumentIds: this.dirtyIds(),
      });
      if (this.current?.id !== detail.id) return;
      this.current = detail;
      this.watch();
    } catch (err) {
      this.error = errorMessage(err, '没能重试');
    }
  }

  async remove(id: string): Promise<void> {
    const ok = await this.resolve(DialogService).confirm('删除后这段对话无法恢复。', {
      title: '删除对话',
      ok: '删除',
      danger: true,
    });
    if (!ok) return;
    this.error = null;
    try {
      await deleteConversation(id);
      this.conversations = this.conversations.filter((item) => item.id !== id);
      if (this.current?.id === id) this.startNew();
    } catch (err) {
      this.error = errorMessage(err, '没删掉');
    }
  }

  override destroy(): void {
    this.clearTimer();
    super.destroy();
  }

  private async loadContextTitle(documentId: string): Promise<void> {
    const ticket = ++this.contextTicket;
    try {
      const doc = await getDocument(documentId);
      if (ticket !== this.contextTicket || this.contextDocId !== documentId) return;
      this.contextTitle = docDisplayTitle(doc);
    } catch {
      if (ticket !== this.contextTicket || this.contextDocId !== documentId) return;
      this.contextTitle = '当前文档';
    }
  }

  private dirtyIds(): string[] {
    try {
      return this.resolve(EditorPresenceService).dirtyDocumentIds();
    } catch {
      return [];
    }
  }

  private watch(): void {
    this.clearTimer();
    if (!this.busy || !this.current) return;
    const id = this.current.id;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh(id);
    }, POLL_MS);
  }

  private async refresh(id: string): Promise<void> {
    if (this.current?.id !== id) return;
    try {
      const detail = await getConversation(id);
      if (this.current?.id !== id) return;
      this.current = detail;
    } catch {
      // The next tick tries again while a reply is still pending.
    }
    this.watch();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
