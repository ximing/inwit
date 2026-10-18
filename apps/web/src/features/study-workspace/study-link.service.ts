import { Service } from '@rabjs/react';
import * as api from '@/api/concepts';
import { DocsService } from '@/pages/docs/docs.service.js';
import { ConceptsService, type ConceptTarget } from '../concepts/concepts.service.js';

/**
 * 双视图联动（T8b）：默认只高亮；显式「定位」才移动/展开另一图。
 * eventId 去重防循环；旧文章/旧主题的迟到结果被忽略。
 */
type LocateSnapshot = { cardId: string | null; annotationId: string | null };

export class StudyLinkService extends Service {
  private lastEventId = 0;
  private boundDocumentId: string | null = null;
  private locateSnapshot: LocateSnapshot | null = null;
  private snapshotsByDocument = new Map<string, LocateSnapshot | null>();

  /** 定位快照跟着文章走。切走时丢掉尚未返回的高亮请求。 */
  retainDocument(documentId: string | null): void {
    if (this.boundDocumentId === documentId) return;
    if (this.boundDocumentId) this.snapshotsByDocument.set(this.boundDocumentId, this.locateSnapshot);
    this.lastEventId += 1;
    this.boundDocumentId = documentId;
    this.locateSnapshot = documentId ? (this.snapshotsByDocument.get(documentId) ?? null) : null;
  }

  get docs(): DocsService {
    return this.resolve(DocsService);
  }

  get concepts(): ConceptsService {
    return this.resolve(ConceptsService);
  }

  /** 脑图卡片被选中 → 高亮关联概念/关系（不动概念图相机/选择）。 */
  async onCardSelected(cardId: string | null): Promise<void> {
    const eventId = ++this.lastEventId;
    const documentId = this.boundDocumentId;
    if (!cardId) {
      if (eventId !== this.lastEventId || this.boundDocumentId !== documentId) return;
      this.concepts.setHighlight(new Set(), new Set());
      return;
    }
    try {
      const { items } = await api.listCardKnowledgeLinks(cardId);
      if (eventId !== this.lastEventId || this.boundDocumentId !== documentId) return;
      const conceptIds = new Set(items.filter((link) => link.conceptId).map((link) => link.conceptId!));
      const relationIds = new Set(items.filter((link) => link.relationId).map((link) => link.relationId!));
      this.concepts.setHighlight(conceptIds, relationIds);
    } catch {
      // 链接读取失败时清空高亮，不打扰阅读
      if (eventId === this.lastEventId) this.concepts.setHighlight(new Set(), new Set());
    }
  }

  /** 概念/关系被选中 → 标记相关脑图卡片与划线位置（不改变脑图状态）。 */
  async onKnowledgeSelected(target: ConceptTarget | null): Promise<{
    cards: { cardId: string; canvasNodeId: string | null; concept: string }[];
    annotations: { annotationId: string; quote: string }[];
  }> {
    const eventId = ++this.lastEventId;
    const documentId = this.concepts.documentId;
    const topicId = this.concepts.topicId;
    if (!target || !documentId || !topicId) return { cards: [], annotations: [] };
    const locations = await api.getKnowledgeLocations(documentId, {
      topicId,
      targetKind: target.kind,
      targetId: target.id,
    });
    if (eventId !== this.lastEventId || this.boundDocumentId !== documentId) return { cards: [], annotations: [] };
    return locations;
  }

  /** 显式定位：脑图标记卡片/正文跳转划线；保留定位前快照供返回。 */
  locateCard(cardId: string): void {
    this.locateSnapshot = {
      cardId: this.docs.activeCardId,
      annotationId: this.docs.activeAnnotationId,
    };
    this.docs.openAnchors([cardId]);
  }

  locateAnnotation(annotationId: string): void {
    this.locateSnapshot = {
      cardId: this.docs.activeCardId,
      annotationId: this.docs.activeAnnotationId,
    };
    this.docs.openAnnotation(annotationId);
  }

  /** 返回定位前状态。 */
  returnFromLocate(): void {
    const snapshot = this.locateSnapshot;
    this.locateSnapshot = null;
    if (!snapshot) return;
    if (snapshot.cardId) this.docs.openAnchors([snapshot.cardId]);
    else if (snapshot.annotationId) this.docs.openAnnotation(snapshot.annotationId);
    else this.docs.closeHighlight();
  }

  get canReturn(): boolean {
    return this.locateSnapshot !== null;
  }
}
