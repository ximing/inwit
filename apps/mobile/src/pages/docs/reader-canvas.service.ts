import { Service } from '@rabjs/react';
import type { CanvasNode, CanvasRevision } from '@inwit/dto';

/**
 * 画布节点和修订列表。
 * 不读文档、批注、sheet、图片 URL 或引擎；那些仍由 ReaderService 编排。
 */
export class ReaderCanvasService extends Service {
  /** 已经落库的画布节点。没摆过的卡片和批注不在这里，读的时候补成根。 */
  canvasNodes: CanvasNode[] = [];
  canvasRevisions: CanvasRevision[] = [];
  canvasRevisionsLoading = false;
  canvasRevisionRestoring: string | null = null;
  canvasHistoryOpen = false;

  private canvasRevisionGen = 0;
  /** 节点列表请求的代数。本地改过树之后，更早的列表结果不再写回。 */
  private canvasGen = 0;

  findNode(id: string): CanvasNode | undefined {
    return this.canvasNodes.find((item) => item.id === id);
  }

  imageKeys(): string[] {
    return [
      ...new Set(
        this.canvasNodes.map((node) => node.imageKey).filter((key): key is string => Boolean(key)),
      ),
    ];
  }

  replaceNodes(nodes: CanvasNode[]): void {
    this.canvasNodes = nodes;
  }

  upsertNode(node: CanvasNode): void {
    const index = this.canvasNodes.findIndex((item) => item.id === node.id);
    if (index < 0) {
      this.canvasNodes = [...this.canvasNodes, node];
      return;
    }
    const next = this.canvasNodes.slice();
    next[index] = node;
    this.canvasNodes = next;
  }

  /** 关掉历史并作废进行中的列表请求。不清除正在恢复的标记。 */
  closeHistory(): void {
    this.canvasHistoryOpen = false;
    this.canvasRevisions = [];
    this.canvasRevisionsLoading = false;
    this.canvasRevisionGen += 1;
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

  storeRevisions(revisions: CanvasRevision[]): void {
    this.canvasRevisions = revisions;
  }

  finishRevisionLoad(gen: number): void {
    if (gen === this.canvasRevisionGen) this.canvasRevisionsLoading = false;
  }

  /** 作废进行中的节点列表请求，并返回新的代数。 */
  bumpCanvasGen(): number {
    return ++this.canvasGen;
  }

  canvasGenMatches(ticket: number): boolean {
    return ticket === this.canvasGen;
  }
}
