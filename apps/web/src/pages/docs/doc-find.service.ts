import { Service } from '@rabjs/react';
import type { Editor } from '@tiptap/core';

export class DocFindService extends Service {
  open = false;
  replaceOpen = false;
  query = '';
  replacement = '';
  caseSensitive = false;
  focusGen = 0;
  focusTarget: 'find' | 'replace' = 'find';
  /** 当前正文编辑器。阅读态的查找条不在编辑器组件里面，靠它取实例。 */
  editor: Editor | null = null;

  attach(editor: Editor): void {
    this.editor = editor;
  }

  detach(editor: Editor): void {
    if (this.editor === editor) this.editor = null;
  }

  showFind(seed: string | null): void {
    if (seed) this.query = seed;
    this.open = true;
    this.focusTarget = 'find';
    this.focusGen += 1;
  }

  showReplace(seed: string | null): void {
    if (seed) this.query = seed;
    this.open = true;
    this.replaceOpen = true;
    this.focusTarget = 'replace';
    this.focusGen += 1;
  }

  close(): void {
    this.open = false;
  }

  toggleReplace(): void {
    this.replaceOpen = !this.replaceOpen;
    if (this.replaceOpen) {
      this.focusTarget = 'replace';
      this.focusGen += 1;
    }
  }

  setQuery(query: string): void {
    this.query = query;
  }

  setReplacement(replacement: string): void {
    this.replacement = replacement;
  }

  toggleCase(): void {
    this.caseSensitive = !this.caseSensitive;
  }
}
