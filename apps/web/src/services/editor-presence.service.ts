import { Service } from '@rabjs/react';

/** The open editor's unsaved document, so the conversation agent will not overwrite it. */
export class EditorPresenceService extends Service {
  documentId: string | null = null;

  set(documentId: string | null): void {
    if (this.documentId === documentId) return;
    this.documentId = documentId;
  }

  dirtyDocumentIds(): string[] {
    return this.documentId ? [this.documentId] : [];
  }
}
