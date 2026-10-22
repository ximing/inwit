import { Service } from '@rabjs/react';
import type { FormatState } from '../../../../../packages/doc-engine/src/protocol';
import { linkDraftHref } from './reader-format-logic.js';

/**
 * 格式菜单看到的标记、链接草稿和公式草稿。
 * 不改 sheet、编辑开关或正文；那些仍由 ReaderService 编排。
 */
export class ReaderFormatService extends Service {
  formatState: FormatState | null = null;
  linkDraft = '';
  editingLink = false;
  mathDraft = '';

  noteFormatState(state: FormatState): void {
    this.formatState = state;
  }

  /** 按当前标记填好链接表。不打开面板。 */
  prepareLinkSheet(): void {
    const state = this.formatState;
    this.editingLink = state?.link === true;
    this.linkDraft = linkDraftHref(state);
  }

  setLinkDraft(value: string): void {
    this.linkDraft = value;
  }

  /** 公式表从空草稿开始。不打开面板。 */
  prepareMathSheet(): void {
    this.mathDraft = '';
  }

  setMathDraft(value: string): void {
    this.mathDraft = value;
  }
}
