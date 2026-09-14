import { Service } from '@rabjs/react';
import { titleFromContent } from '@inwit/dto';
import { createDocument, getDocument, updateDocument } from '@/api/documents';
import { errorMessage } from '@/api/client';
import { formatTimeHm } from '@/lib/format';

const SAVE_DEBOUNCE_MS = 2000;

function hasSubstance(markdown: string): boolean {
  return markdown.replace(/[#*_>`~\-[\]()]/g, '').trim().length > 0;
}

export class EditorService extends Service {
  phase: 'idle' | 'new' | 'loading' | 'ready' | 'missing' = 'idle';
  id: string | null = null;
  topicId: string | null = null;
  draftMd = '';
  lastSavedMd = '';
  seedKey = 'new';
  seedMarkdown: string | null = null;
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  savedAt: Date | null = null;
  error: string | null = null;
  justCreated = false;
  saveTimer: ReturnType<typeof setTimeout> | null = null;

  get saveLabel(): string {
    if (this.saveState === 'saving') return '保存中';
    if (this.saveState === 'error' && this.error) return this.error;
    if (this.saveState === 'saved' && this.savedAt) {
      return `已保存 ${formatTimeHm(this.savedAt)}`;
    }
    return '';
  }

  async open(routeId: string, topicId: string | null): Promise<void> {
    if (routeId === 'new') {
      if (this.justCreated) {
        this.justCreated = false;
        return;
      }
      this.initNew(topicId);
      return;
    }
    if (this.id === routeId && this.phase === 'ready') {
      this.justCreated = false;
      return;
    }
    await this.load(routeId);
  }

  initNew(topicId: string | null): void {
    this.clearTimer();
    this.phase = 'new';
    this.id = null;
    this.topicId = topicId;
    this.draftMd = '';
    this.lastSavedMd = '';
    this.seedKey = 'new';
    this.seedMarkdown = null;
    this.saveState = 'idle';
    this.savedAt = null;
    this.error = null;
    this.justCreated = false;
  }

  async load(id: string): Promise<void> {
    this.clearTimer();
    this.phase = 'loading';
    this.error = null;
    try {
      const doc = await getDocument(id);
      this.id = doc.id;
      this.topicId = doc.topicId;
      this.draftMd = doc.contentMd;
      this.lastSavedMd = doc.contentMd;
      this.seedMarkdown = doc.contentMd;
      this.seedKey = doc.id;
      this.savedAt = new Date(doc.updatedAt);
      this.saveState = 'saved';
      this.phase = 'ready';
    } catch (err) {
      this.phase = 'missing';
      this.error = errorMessage(err, '打不开这份文档');
    }
  }

  noteChange(markdown: string): void {
    this.draftMd = markdown;
    if (markdown === this.lastSavedMd) {
      this.clearTimer();
      if (this.saveState !== 'saving') this.saveState = this.id ? 'saved' : 'idle';
      return;
    }
    this.scheduleSave();
  }

  scheduleSave(): void {
    this.clearTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  clearTimer(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  async save(): Promise<void> {
    this.clearTimer();
    const contentMd = this.draftMd;
    if (!hasSubstance(contentMd)) return;
    if (this.id && contentMd === this.lastSavedMd) return;
    if (this.$model.save.loading) return;

    this.saveState = 'saving';
    this.error = null;
    const title = titleFromContent(contentMd);
    try {
      if (!this.id) {
        const created = await createDocument({
          title,
          contentMd,
          source: 'editor',
          ...(this.topicId ? { topicId: this.topicId } : {}),
        });
        this.id = created.id;
        this.justCreated = true;
        this.phase = 'ready';
        this.lastSavedMd = created.contentMd;
      } else {
        const updated = await updateDocument(this.id, { title, contentMd });
        this.lastSavedMd = updated.contentMd;
      }
      this.savedAt = new Date();
      this.saveState = 'saved';
      if (this.draftMd !== this.lastSavedMd) this.scheduleSave();
    } catch (err) {
      this.saveState = 'error';
      this.error = errorMessage(err, '没存上，再试一次');
    }
  }

  override destroy(): void {
    this.clearTimer();
    super.destroy();
  }
}
