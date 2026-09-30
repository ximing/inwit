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
  /** Archived elsewhere: persist must not write again. */
  remoteGone = false;
  /** Sync reseed restores scroll and does not focus. load/initNew clear it. */
  preserveViewport = false;
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  saveInflight: Promise<void> | null = null;
  onCreated: ((doc: Document) => void) | null = null;
  onSaved:
    | ((doc: {
        id: string;
        title: string | null;
        contentJson: PmDocJson;
        updatedAt: string;
      }) => void)
    | null = null;
  /** DocsService bumps cardWriteGen before the PUT leaves. */
  onLocalWriteStart: (() => void) | null = null;
  /** Runs after saveInflight is cleared so a dropped GET can replay. */
  onLocalWriteEnd: (() => void) | null = null;

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

  /** Remote title. Skip while the body or the title input still has a local draft. */
  applyRemoteMeta(doc: { id: string; title: string | null }): void {
    if (this.remoteGone) return;
    if (this.id !== doc.id || this.phase !== 'ready') return;
    if (this.saveInflight) return;
    if (!jsonEqual(this.draftJson, this.lastSavedJson)) return;
    if (this.draftTitle.trim() !== this.lastSavedTitle.trim()) return;
    const next = doc.title ?? '';
    if (next === this.lastSavedTitle) return;
    this.lastSavedTitle = next;
    this.draftTitle = next;
  }

  /**
   * Clean editor takes the server body. Same JSON does not reseed, so a
   * pending → digested status change does not jump the viewport.
   */
  applyRemoteBody(doc: { id: string; updatedAt: string; contentJson: PmDocJson }): void {
    if (this.remoteGone) return;
    if (this.id !== doc.id || this.phase !== 'ready') return;
    const json = clonePmJson(doc.contentJson);
    if (jsonEqual(json, this.lastSavedJson) && jsonEqual(json, this.draftJson)) return;
    this.preserveViewport = true;
    this.lastSavedJson = json;
    this.draftJson = clonePmJson(json);
    this.seedDoc = isBlankPmDoc(json) ? null : clonePmJson(json);
    const nextKey = `${doc.id}:${doc.updatedAt}`;
    this.seedKey = nextKey === this.seedKey ? `${nextKey}:r` : nextKey;
    this.savedAt = new Date(doc.updatedAt);
    if (!this.dirty) this.saveState = 'saved';
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
    this.remoteGone = false;
    this.preserveViewport = false;
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
    this.remoteGone = false;
    this.preserveViewport = false;
    this.phase = 'idle';
    this.id = null;
    this.justCreated = false;
    this.error = null;
    this.saveState = 'idle';
  }

  async load(id: string): Promise<void> {
    this.clearTimer();
    this.remoteGone = false;
    this.preserveViewport = false;
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
    if (this.remoteGone) return;
    if (!this.dirty) {
      this.clearTimer();
      if (this.saveState !== 'saving') this.saveState = this.id ? 'saved' : 'idle';
      return;
    }
    this.scheduleSave();
  }

  scheduleSave(): void {
    if (this.remoteGone) return;
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
    if (this.remoteGone) return;
    if (this.saveInflight) {
      await this.saveInflight;
      if (this.remoteGone) return;
      if (!this.dirty && this.saveState !== 'error') return;
    }
    const run = this.persist();
    this.saveInflight = run;
    try {
      await run;
    } finally {
      if (this.saveInflight === run) this.saveInflight = null;
      this.onLocalWriteEnd?.();
    }
  }

  private async persist(): Promise<void> {
    if (this.remoteGone) return;
    this.clearTimer();
    const contentJson = this.draftJson;
    const titleAtSend = this.draftTitle;
    const draftTitle = titleAtSend.trim();
    const titleValue = draftTitle.length > 0 ? draftTitle : null;
    const lastTitle = this.lastSavedTitle.trim() || null;
    if (!this.id && isBlankPmDoc(contentJson)) return;
    if (this.id && jsonEqual(contentJson, this.lastSavedJson) && titleValue === lastTitle) return;

    // Before the request: an in-flight getDocument must not paint the pre-save detail.
    this.onLocalWriteStart?.();
    this.saveState = 'saving';
    this.error = null;
    try {
      let updatedAt: string | null = null;
      if (!this.id) {
        const created = await createDocument({
          contentJson,
          source: 'editor',
          ...(titleValue ? { title: titleValue } : {}),
          ...(this.topicId ? { topicId: this.topicId } : {}),
        });
        if (this.remoteGone) return;
        this.id = created.id;
        this.justCreated = true;
        this.phase = 'ready';
        this.lastSavedJson = clonePmJson(created.contentJson);
        this.lastSavedTitle = created.title ?? '';
        if (this.draftTitle === titleAtSend) this.draftTitle = this.lastSavedTitle;
        updatedAt = created.updatedAt;
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
        if (this.remoteGone) return;
        this.lastSavedJson = clonePmJson(updated.contentJson);
        this.lastSavedTitle = updated.title ?? '';
        if (this.draftTitle === titleAtSend) this.draftTitle = this.lastSavedTitle;
        updatedAt = updated.updatedAt;
      }
      this.savedAt = new Date();
      this.saveState = 'saved';
      if (this.id && updatedAt) {
        this.onSaved?.({
          id: this.id,
          title: this.lastSavedTitle.trim() || null,
          contentJson: this.lastSavedJson,
          updatedAt,
        });
      }
      if (this.dirty) this.scheduleSave();
    } catch (err) {
      if (this.remoteGone) return;
      this.saveState = 'error';
      this.error = errorMessage(err, '没存上，再试一次');
    }
  }

  override destroy(): void {
    this.clearTimer();
    super.destroy();
  }
}
