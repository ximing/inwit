import { Service } from '@rabjs/react';
import { EMPTY_PM_DOC, type Document, type PmDocJson, type UpdateDocumentInput } from '@inwit/dto';
import { createDocument, getDocument, updateDocument } from '@/api/documents';
import { errorMessage } from '@/api/client';
import { formatTimeHm } from '@/lib/format';
import { asPmJson, clonePmJson, isBlankPmDoc, jsonEqual } from '@/lib/pm-doc';

const SAVE_DEBOUNCE_MS = 2000;

export class EditorService extends Service {
  phase: 'idle' | 'new' | 'loading' | 'ready' | 'missing' = 'idle';
  id: string | null = null;
  topicId: string | null = null;
  draftTitle = '';
  lastSavedTitle = '';
  draftJson: PmDocJson = clonePmJson(EMPTY_PM_DOC);
  lastSavedJson: PmDocJson = clonePmJson(EMPTY_PM_DOC);
  seedKey = 'new';
  seedDoc: PmDocJson | null = null;
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  savedAt: Date | null = null;
  error: string | null = null;
  justCreated = false;
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  saveInflight: Promise<void> | null = null;
  onCreated: ((doc: Document) => void) | null = null;
  onSaved: ((doc: { id: string; title: string | null; contentJson: PmDocJson }) => void) | null = null;

  get saveLabel(): string {
    if (this.saveState === 'saving') return '保存中…';
    if (this.saveState === 'error' && this.error) return this.error;
    if (this.saveState === 'saved' && this.savedAt) {
      return `已保存 · ${formatTimeHm(this.savedAt)}`;
    }
    return '';
  }

  get dirty(): boolean {
    return (
      !jsonEqual(this.draftJson, this.lastSavedJson) ||
      this.draftTitle.trim() !== this.lastSavedTitle.trim()
    );
  }

  /** Digest/poll rewrite: apply remote title only if the input is not dirty. */
  applyRemoteMeta(doc: { id: string; title: string | null }): void {
    if (this.id !== doc.id || this.phase !== 'ready') return;
    if (this.draftTitle.trim() !== this.lastSavedTitle.trim()) return;
    const next = doc.title ?? '';
    if (next === this.lastSavedTitle) return;
    this.lastSavedTitle = next;
    this.draftTitle = next;
  }

  async open(routeId: string, topicId: string | null): Promise<void> {
    if (routeId === 'new') {
      if (this.justCreated) {
        this.justCreated = false;
        return;
      }
      if (this.phase === 'new') return;
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
    this.draftTitle = '';
    this.lastSavedTitle = '';
    this.draftJson = clonePmJson(EMPTY_PM_DOC);
    this.lastSavedJson = clonePmJson(EMPTY_PM_DOC);
    this.seedKey = 'new';
    this.seedDoc = null;
    this.saveState = 'idle';
    this.savedAt = null;
    this.error = null;
    this.justCreated = false;
  }

  idle(): void {
    this.clearTimer();
    this.phase = 'idle';
    this.id = null;
    this.justCreated = false;
    this.error = null;
    this.saveState = 'idle';
  }

  async load(id: string): Promise<void> {
    this.clearTimer();
    this.phase = 'loading';
    this.error = null;
    try {
      const doc = await getDocument(id);
      const json = clonePmJson(doc.contentJson);
      const blank = isBlankPmDoc(json);
      this.id = doc.id;
      this.topicId = doc.topicId;
      this.draftTitle = doc.title ?? '';
      this.lastSavedTitle = doc.title ?? '';
      this.draftJson = json;
      this.lastSavedJson = clonePmJson(json);
      this.seedDoc = blank ? null : clonePmJson(json);
      this.seedKey = `${doc.id}:${doc.updatedAt}`;
      this.savedAt = new Date(doc.updatedAt);
      this.saveState = 'saved';
      this.phase = 'ready';
    } catch (err) {
      this.phase = 'missing';
      this.error = errorMessage(err, '打不开这份文档');
    }
  }

  noteTitleChange(title: string): void {
    this.draftTitle = title;
    this.noteDirty();
  }

  noteChange(json: unknown): void {
    this.draftJson = asPmJson(json);
    this.noteDirty();
  }

  setTopicId(topicId: string | null): void {
    this.topicId = topicId;
  }

  private noteDirty(): void {
    if (!this.dirty) {
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
    if (this.saveInflight) {
      await this.saveInflight;
      if (!this.dirty && this.saveState !== 'error') return;
    }
    const run = this.persist();
    this.saveInflight = run;
    try {
      await run;
    } finally {
      if (this.saveInflight === run) this.saveInflight = null;
    }
  }

  private async persist(): Promise<void> {
    this.clearTimer();
    const contentJson = this.draftJson;
    const draftTitle = this.draftTitle.trim();
    const titleValue = draftTitle.length > 0 ? draftTitle : null;
    const lastTitle = this.lastSavedTitle.trim() || null;
    if (!this.id && isBlankPmDoc(contentJson)) return;
    if (this.id && jsonEqual(contentJson, this.lastSavedJson) && titleValue === lastTitle) return;

    this.saveState = 'saving';
    this.error = null;
    try {
      if (!this.id) {
        const created = await createDocument({
          contentJson,
          source: 'editor',
          ...(titleValue ? { title: titleValue } : {}),
          ...(this.topicId ? { topicId: this.topicId } : {}),
        });
        this.id = created.id;
        this.justCreated = true;
        this.phase = 'ready';
        this.lastSavedJson = clonePmJson(created.contentJson);
        this.lastSavedTitle = created.title ?? '';
        this.draftTitle = created.title ?? this.draftTitle;
        this.onCreated?.(created);
      } else {
        const patch: UpdateDocumentInput = {};
        if (titleValue !== lastTitle) patch.title = titleValue;
        if (!jsonEqual(contentJson, this.lastSavedJson)) patch.contentJson = contentJson;
        if (patch.title === undefined && patch.contentJson === undefined) {
          this.saveState = 'saved';
          return;
        }
        const updated = await updateDocument(this.id, patch);
        this.lastSavedJson = clonePmJson(updated.contentJson);
        this.lastSavedTitle = updated.title ?? '';
      }
      this.savedAt = new Date();
      this.saveState = 'saved';
      if (this.id) {
        this.onSaved?.({
          id: this.id,
          title: this.lastSavedTitle.trim() || null,
          contentJson: this.lastSavedJson,
        });
      }
      if (this.dirty) this.scheduleSave();
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
