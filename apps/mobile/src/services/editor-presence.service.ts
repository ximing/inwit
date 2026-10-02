import { Service } from '@rabjs/react';

/** The open reader's unsaved body, so a conversation will not overwrite it. */
export class EditorPresenceService extends Service {
  documentId: string | null = null;
  bodyDirty = false;

  set(documentId: string | null, bodyDirty: boolean): void {
    this.documentId = documentId;
    this.bodyDirty = Boolean(documentId) && bodyDirty;
  }
}
