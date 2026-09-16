import { PdfAnnotationSubtype } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  fromTransferItem,
  geometryFromRects,
  importAnnotationsFromOwn,
  quadFromRect,
  rectFromQuad,
  toTransferItem,
} from './annotation-adapter';

const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 8 } };

describe('quad/rect conversion', () => {
  it('round-trips an 8-point quad', () => {
    const quad = quadFromRect(rect);
    expect(quad).toEqual([10, 20, 40, 20, 40, 28, 10, 28]);
    expect(rectFromQuad(quad)).toEqual(rect);
  });

  it('accepts a compact [x, y, w, h] quad', () => {
    expect(rectFromQuad([10, 20, 30, 8])).toEqual(rect);
  });
});

describe('toTransferItem / fromTransferItem', () => {
  it('maps a highlight to EmbedPDF HIGHLIGHT with segmentRects', () => {
    const item = toTransferItem({
      id: 'ann-1',
      pageIndex: 2,
      kind: 'highlight',
      geometry: geometryFromRects([rect], '#ffcc00'),
      quote: '一段原文',
    });
    expect(item?.annotation.type).toBe(PdfAnnotationSubtype.HIGHLIGHT);
    expect(item?.annotation.pageIndex).toBe(2);
    expect(item?.annotation.id).toBe('ann-1');
    const back = fromTransferItem(item!);
    expect(back?.kind).toBe('highlight');
    expect(back?.pageIndex).toBe(2);
    expect(back?.geometry.color).toBe('#ffcc00');
    expect(back?.geometry.quads[0]).toEqual(quadFromRect(rect));
  });

  it('maps an excerpt to a SQUARE annotation', () => {
    const items = importAnnotationsFromOwn([
      {
        id: 'ann-2',
        pageIndex: 0,
        kind: 'excerpt',
        geometry: { quads: [quadFromRect(rect)] },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.annotation.type).toBe(PdfAnnotationSubtype.SQUARE);
  });
});
