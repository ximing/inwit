import { Service } from '@rabjs/react';
import type { CanvasNode, CanvasRevision } from '@inwit/dto';
import { CanvasHistory, type CanvasOp } from './canvas-history.js';

/**
 * 画布节点、会话撤销和修订面板。
 * 不读文档、同步回声、选区或批注列表；那些仍由 DocsService 编排。
 */
export class DocsCanvasService extends Service {
  /** 已经落库的画布节点。没摆过的卡片和批注不在这里，读的时候补成根。 */
  canvasNodes: CanvasNode[] = [];
  canvasUploading = false;
  canvasUndo = 0;
  canvasRedo = 0;
  canvasRevisions: CanvasRevision[] = [];
  canvasRevisionsOpen = false;
  canvasRevisionsLoading = false;
  canvasRevisionRestoring: string | null = null;

  private canvasRevisionGen = 0;
  private canvasHistory = new CanvasHistory();
  /** 撤销和重做自己再改树时不再记一笔。 */
  private historyGate = true;

  /** 为 false 时正在走撤销或重做，失败要抛回去而不是再弹提示。 */
  get historyOpen(): boolean {
    return this.historyGate;
  }

  resetCanvasHistory(): void {
    this.canvasHistory.clear();
    this.canvasUndo = 0;
    this.canvasRedo = 0;
  }

  private syncCanvasHistory(): void {
    this.canvasUndo = this.canvasHistory.undoCount;
    this.canvasRedo = this.canvasHistory.redoCount;
  }

  closeCanvasRevisionPanel(): void {
    this.canvasRevisionsOpen = false;
    this.canvasRevisions = [];
    this.canvasRevisionsLoading = false;
    this.canvasRevisionRestoring = null;
    this.canvasRevisionGen += 1;
  }

  closeCanvasRevisions(): void {
    this.canvasRevisionsOpen = false;
  }

  /** 开始拉修订列表。返回的代数用来丢掉过期结果。 */
  startRevisionLoad(): number {
    const gen = ++this.canvasRevisionGen;
    this.canvasRevisionsLoading = true;
    return gen;
  }

  revisionGenMatches(gen: number): boolean {
    return gen === this.canvasRevisionGen;
  }

  finishRevisionLoad(gen: number): void {
    if (gen === this.canvasRevisionGen) this.canvasRevisionsLoading = false;
  }

  rememberCanvas(undo: CanvasOp, redo: CanvasOp): void {
    if (!this.historyGate) return;
    this.canvasHistory.push(undo, redo);
    this.syncCanvasHistory();
  }

  suspendHistory(): void {
    this.historyGate = false;
  }

  resumeHistory(): void {
    this.historyGate = true;
    this.syncCanvasHistory();
  }

  peekHistory(dir: 'undo' | 'redo'): CanvasOp | null {
    return dir === 'undo' ? this.canvasHistory.peekUndo() : this.canvasHistory.peekRedo();
  }

  commitHistory(dir: 'undo' | 'redo'): void {
    if (dir === 'undo') this.canvasHistory.commitUndo();
    else this.canvasHistory.commitRedo();
  }

  remapHistory(from: string, to: string): void {
    this.canvasHistory.remap(from, to);
  }
}
