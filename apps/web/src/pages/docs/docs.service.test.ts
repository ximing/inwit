import type { Annotation, CanvasNode, DocumentCard, DocumentDetail } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';
import { DocsAnnotationsService } from './docs-annotations.service';
import { DocsService } from './docs.service';

describe('document anchor card selection', () => {
  it('collapses the previous cards when another anchor is clicked', () => {
    const service = new DocsService();
    service.openAnchors(['card-a']);
    service.openAnchors(['card-b']);

    expect(service.expandedCardIds).toEqual(['card-b']);
    expect(service.activeCardId).toBe('card-b');
    expect(service.scrollCardId).toBe('card-b');
  });

  it('replaces a card opened from the rail with all cards linked to the new anchor', () => {
    const service = new DocsService();
    service.toggleCard('card-a');
    service.openAnchors(['card-b', 'card-c', 'card-b']);

    expect(service.expandedCardIds).toEqual(['card-b', 'card-c']);
    expect(service.activeCardId).toBe('card-b');

    service.toggleCard('card-b');
    expect(service.expandedCardIds).toEqual([]);
    expect(service.activeCardId).toBeNull();
  });
});

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
};

function card(id: string, anchorText: string): DocumentCard {
  return {
    id,
    anchorText,
    anchorBlockIndex: 1,
    hasImage: false,
    concept: '概念',
    questions: [],
  } as DocumentCard;
}

function note(id: string, quote: string): Annotation {
  return {
    id,
    quote,
    note: '想法',
    kind: 'text',
    anchorBlockIndex: 1,
    imageKey: null,
  } as Annotation;
}

function freeNode(id: string, kind: 'text' | 'image'): CanvasNode {
  return {
    id,
    documentId: 'doc-1',
    kind,
    cardId: null,
    annotationId: null,
    text: kind === 'text' ? '节点' : null,
    imageKey: kind === 'image' ? 'asset:key' : null,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function canvasService(cards: DocumentCard[], notes: Annotation[], nodes: CanvasNode[] = []) {
  const service = new DocsService();
  const annotations = new DocsAnnotationsService();
  annotations.annotations = notes;
  vi.spyOn(service, 'resolve').mockImplementation(((token: unknown) => {
    if (token === DocsAnnotationsService) return annotations;
    throw new Error(`unexpected resolve: ${String(token)}`);
  }) as typeof service.resolve);
  service.doc = { id: 'doc-1', cards, contentJson: body } as DocumentDetail;
  service.canvasNodes = nodes;
  return service;
}

describe('mind map document reveal', () => {
  it('reveals a card without expanding it, and a second select does not clear it', () => {
    const service = canvasService([card('card-1', 'hello')], []);
    service.expandedCardIds = ['other'];

    service.selectCanvasNode('card-1');

    expect(service.activeCardId).toBe('card-1');
    expect(service.activeAnnotationId).toBeNull();
    expect(service.bodyFocusCardId).toBe('card-1');
    expect(service.expandedCardIds).toEqual(['other']);
    expect(service.editingCardId).toBeNull();
    expect(service.documentRevealSeq).toBe(1);

    service.bodyFocusCardId = null;
    service.selectCanvasNode('card-1');

    expect(service.activeCardId).toBe('card-1');
    expect(service.bodyFocusCardId).toBe('card-1');
    expect(service.expandedCardIds).toEqual(['other']);
    expect(service.editingCardId).toBeNull();
    expect(service.documentRevealSeq).toBe(2);
  });

  it('reveals an annotation without toggling it off on the second select', () => {
    const service = canvasService([], [note('note-1', 'hello')]);

    service.selectCanvasNode('note-1');
    service.bodyFocusAnnotationId = null;
    service.selectCanvasNode('note-1');

    expect(service.activeAnnotationId).toBe('note-1');
    expect(service.activeCardId).toBeNull();
    expect(service.bodyFocusAnnotationId).toBe('note-1');
    expect(service.expandedCardIds).toEqual([]);
    expect(service.documentRevealSeq).toBe(2);
  });

  it('selects a lost card or annotation in the forest but does not reveal it', () => {
    const service = canvasService(
      [card('card-lost', 'missing from the document')],
      [note('note-lost', 'also missing')],
    );
    service.activeCardId = 'card-lost';
    service.expandedCardIds = ['stay'];

    service.selectCanvasNode('card-lost');
    service.selectCanvasNode('note-lost');

    expect(service.activeCardId).toBe('card-lost');
    expect(service.activeAnnotationId).toBeNull();
    expect(service.bodyFocusCardId).toBeNull();
    expect(service.bodyFocusAnnotationId).toBeNull();
    expect(service.expandedCardIds).toEqual(['stay']);
    expect(service.documentRevealSeq).toBe(0);
  });

  it('does not reveal a text or image node', () => {
    const service = canvasService([], [], [freeNode('text-1', 'text'), freeNode('image-1', 'image')]);
    service.expandedCardIds = ['stay'];
    expect(service.canvasForest.map((member) => member.kind).sort()).toEqual(['image', 'text']);

    service.selectCanvasNode('text-1');
    service.selectCanvasNode('image-1');

    expect(service.activeCardId).toBeNull();
    expect(service.activeAnnotationId).toBeNull();
    expect(service.bodyFocusCardId).toBeNull();
    expect(service.bodyFocusAnnotationId).toBeNull();
    expect(service.expandedCardIds).toEqual(['stay']);
    expect(service.documentRevealSeq).toBe(0);
  });
});
