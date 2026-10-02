import { Service } from '@rabjs/react';
import type { Conversation, ConversationDetail, LlmConfig } from '@inwit/dto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, errorMessage } from '@/api/client';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  retryConversationMessage,
  sendConversationMessage,
} from '@/api/conversations';
import { listLlmConfigs } from '@/api/llm';
import { EditorPresenceService } from '@/services/editor-presence.service';
import { capDocumentMentions, dirtyDocumentIds } from './chat-logic';

const STORAGE_KEY = 'inwit-assistant-conversation';
const MODEL_KEY = 'inwit-assistant-llm';
const POLL_MS = 400;

async function readStored(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, id: string | null): void {
  void (id ? AsyncStorage.setItem(key, id) : AsyncStorage.removeItem(key)).catch(() => undefined);
}

export class ChatService extends Service {
  conversations: Conversation[] = [];
  current: ConversationDetail | null = null;
  models: LlmConfig[] = [];
  /** Null omits llmConfigId and uses the account default. */
  modelId: string | null = null;
  historyOpen = false;
  error: string | null = null;
  draft = '';
  mentions: { id: string; title: string }[] = [];
  private listTicket = 0;
  private openTicket = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    void this.boot();
  }

  get busy(): boolean {
    return this.current?.messages.some((message) => message.status === 'pending') ?? false;
  }

  get modelLabel(): string {
    const picked = this.models.find((item) => item.id === this.modelId);
    return picked?.model ?? '默认';
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) void this.loadList();
  }

  closeHistory(): void {
    this.historyOpen = false;
  }

  startNew(): void {
    this.current = null;
    this.historyOpen = false;
    this.error = null;
    this.clearTimer();
    writeStored(STORAGE_KEY, null);
  }

  chooseModel(id: string | null): void {
    this.modelId = id && this.models.some((item) => item.id === id) ? id : null;
    writeStored(MODEL_KEY, this.modelId);
  }

  addMention(item: { id: string; title: string }): boolean {
    const ids = capDocumentMentions([...this.mentions.map((mention) => mention.id), item.id]);
    if (!ids.includes(item.id)) return false;
    if (this.mentions.some((mention) => mention.id === item.id)) return true;
    this.mentions = [...this.mentions, { id: item.id, title: item.title }];
    return true;
  }

  removeMention(id: string): void {
    this.mentions = this.mentions.filter((item) => item.id !== id);
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
      writeStored(STORAGE_KEY, detail.id);
      this.watch();
    } catch (err) {
      if (ticket !== this.openTicket) return;
      if (err instanceof ApiError && err.status === 404) {
        if (this.current?.id === id) this.current = null;
        writeStored(STORAGE_KEY, null);
        return;
      }
      if (!quiet) this.error = errorMessage(err, '打不开这段对话');
    }
  }

  async send(): Promise<boolean> {
    const trimmed = this.draft.trim();
    if (!trimmed || this.busy) return false;
    this.error = null;
    const input = this.turnInput(trimmed);
    try {
      const detail = this.current
        ? await sendConversationMessage(this.current.id, input)
        : await createConversation(input);
      this.current = detail;
      this.draft = '';
      this.mentions = [];
      this.historyOpen = false;
      writeStored(STORAGE_KEY, detail.id);
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
        ...(this.modelId ? { llmConfigId: this.modelId } : {}),
      });
      if (this.current?.id !== detail.id) return;
      this.current = detail;
      this.watch();
    } catch (err) {
      this.error = errorMessage(err, '没能重试');
    }
  }

  async remove(id: string): Promise<void> {
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

  private async boot(): Promise<void> {
    const [stored, model] = await Promise.all([readStored(STORAGE_KEY), readStored(MODEL_KEY)]);
    this.modelId = model;
    void this.loadModels();
    void this.loadList();
    if (stored) void this.open(stored, true);
  }

  private async loadModels(): Promise<void> {
    try {
      const models = await listLlmConfigs();
      this.models = models;
      if (this.modelId && !models.some((item) => item.id === this.modelId)) this.chooseModel(null);
    } catch {
      // The default model still works when the list is unavailable.
    }
  }

  private turnInput(text: string) {
    return {
      text,
      documentIds: capDocumentMentions(this.mentions.map((item) => item.id)),
      dirtyDocumentIds: this.dirtyIds(),
      ...(this.modelId ? { llmConfigId: this.modelId } : {}),
    };
  }

  private dirtyIds(): string[] {
    try {
      const presence = this.resolve(EditorPresenceService);
      return dirtyDocumentIds(presence.documentId, presence.bodyDirty);
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
