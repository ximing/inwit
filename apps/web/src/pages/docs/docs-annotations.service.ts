import { Service } from '@rabjs/react';
import {
  cardInputFromAnnotation,
  type Annotation,
  type CreateAnnotationInput,
} from '@inwit/dto';
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotationImage,
  updateAnnotation,
} from '@/api/annotations';
import { getCardImage } from '@/api/cards';
import { errorMessage } from '@/api/client';
import {
  isPresignedStale,
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from '@/lib/presign-cache-logic';
import { DocsService } from './docs.service';

export class DocsAnnotationsService extends Service {
  annotations: Annotation[] = [];
  annotationImageUrls: Record<string, PresignedUrlEntry> = {};
  cardImageUrls: Record<string, PresignedUrlEntry> = {};
  convertingAnnotationId: string | null = null;

  get docs(): DocsService {
    return this.resolve(DocsService);
  }

  async addAnnotation(
    documentId: string,
    quote: string,
    note: string,
    extra?: Pick<
      CreateAnnotationInput,
      'kind' | 'pageIndex' | 'geometry' | 'imageKey' | 'anchorBlockIndex'
    > & { from?: number; to?: number },
  ): Promise<boolean> {
    const clipped = quote.trim();
    if (!clipped) return false;
    try {
      const created = await createAnnotation({
        documentId,
        quote: clipped,
        note: note.trim(),
        ...(extra?.kind ? { kind: extra.kind } : {}),
        ...(extra?.pageIndex !== undefined ? { pageIndex: extra.pageIndex } : {}),
        ...(extra?.geometry ? { geometry: extra.geometry } : {}),
        ...(extra?.imageKey ? { imageKey: extra.imageKey } : {}),
        ...(extra?.anchorBlockIndex !== undefined ? { anchorBlockIndex: extra.anchorBlockIndex } : {}),
      });
      if (!this.docs.doc || this.docs.doc.id === documentId) {
        this.annotations = [...this.annotations.filter((item) => item.id !== created.id), created];
      }
      if (created.kind === 'text') {
        const host = this.docs.editorHost;
        if (host && extra?.from != null && extra.to != null) {
          host.applyEntityMark('annotation', created.id, extra.from, extra.to);
        } else {
          host?.ensureEntityMarks(this.docs.doc?.cards ?? [], this.annotations);
        }
      }
      this.docs.openAnnotation(created.id);
      return true;
    } catch (err) {
      this.docs.showToast(errorMessage(err, '没记下这条批注'));
      return false;
    }
  }

  async saveAnnotationNote(id: string, note: string): Promise<boolean> {
    try {
      const updated = await updateAnnotation(id, { note });
      this.annotations = this.annotations.map((item) => (item.id === id ? updated : item));
      return true;
    } catch (err) {
      this.docs.showToast(errorMessage(err, '没改上'));
      return false;
    }
  }

  async removeAnnotation(id: string): Promise<void> {
    try {
      await deleteAnnotation(id);
      this.annotations = this.annotations.filter((item) => item.id !== id);
      if (this.docs.activeAnnotationId === id) this.docs.activeAnnotationId = null;
      if (this.annotationImageUrls[id]) {
        const next = { ...this.annotationImageUrls };
        delete next[id];
        this.annotationImageUrls = next;
      }
    } catch (err) {
      this.docs.showToast(errorMessage(err, '没删掉'));
    }
  }

  annotationImageUrl(id: string): string | null {
    return livePresignedUrl(this.annotationImageUrls[id]);
  }

  async loadAnnotationImage(id: string, force = false): Promise<string | null> {
    const existing = this.annotationImageUrls[id];
    if (!force && existing && !isPresignedStale(existing)) return existing.url;
    try {
      const { url } = await getAnnotationImage(id);
      this.annotationImageUrls = { ...this.annotationImageUrls, [id]: { url, fetchedAt: Date.now() } };
      return url;
    } catch {
      return null;
    }
  }

  retryAnnotationImage(id: string): void {
    if (!shouldRetryPresign(this.annotationImageUrls[id])) return;
    void this.loadAnnotationImage(id, true);
  }

  cardImageUrl(id: string): string | null {
    return livePresignedUrl(this.cardImageUrls[id]);
  }

  async loadCardImage(id: string, force = false): Promise<string | null> {
    const existing = this.cardImageUrls[id];
    if (!force && existing && !isPresignedStale(existing)) return existing.url;
    try {
      const { url } = await getCardImage(id);
      this.cardImageUrls = { ...this.cardImageUrls, [id]: { url, fetchedAt: Date.now() } };
      return url;
    } catch {
      return null;
    }
  }

  retryCardImage(id: string): void {
    if (!shouldRetryPresign(this.cardImageUrls[id])) return;
    void this.loadCardImage(id, true);
  }

  async cardFromExcerpt(annotationId: string): Promise<boolean> {
    if (this.convertingAnnotationId) return false;
    const item = this.annotations.find((note) => note.id === annotationId);
    if (!item) return false;
    const input = cardInputFromAnnotation(item);
    if (!input) {
      this.docs.showToast('这条批注还没有笔记');
      return false;
    }
    this.convertingAnnotationId = annotationId;
    try {
      return await this.docs.addManualCard(input);
    } finally {
      this.convertingAnnotationId = null;
    }
  }
}
