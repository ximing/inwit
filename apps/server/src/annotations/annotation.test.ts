import {
  createAnnotationInputSchema,
  excerptUploadInputSchema,
  IMAGE_EXCERPT_QUOTE,
  upsertOcrConfigInputSchema,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';

const documentId = '11111111-1111-4111-8111-111111111111';
const base = { documentId, quote: '一段原文' };

describe('createAnnotationInputSchema', () => {
  it('accepts a text annotation without kind (legacy payload)', () => {
    const parsed = createAnnotationInputSchema.parse(base);
    expect(parsed.kind).toBeUndefined();
    expect(parsed.quote).toBe('一段原文');
  });

  it('rejects text annotations that carry pdf or media fields', () => {
    expect(createAnnotationInputSchema.safeParse({ ...base, pageIndex: 0 }).success).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        ...base,
        kind: 'text',
        geometry: { quads: [[0, 0, 1, 1]] },
      }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({ ...base, imageKey: 'docs/u/d/excerpts/a.png' }).success,
    ).toBe(false);
    expect(createAnnotationInputSchema.safeParse({ ...base, positionMs: 1200 }).success).toBe(false);
  });

  it('requires pageIndex and geometry when kind is pdf', () => {
    expect(createAnnotationInputSchema.safeParse({ ...base, kind: 'pdf' }).success).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({ ...base, kind: 'pdf', pageIndex: 0 }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        ...base,
        kind: 'pdf',
        geometry: { quads: [[0, 0, 1, 1]] },
      }).success,
    ).toBe(false);
  });

  it('accepts a pdf annotation with pageIndex, geometry, and optional imageKey', () => {
    const parsed = createAnnotationInputSchema.parse({
      ...base,
      kind: 'pdf',
      pageIndex: 0,
      geometry: { quads: [[0, 0, 1, 1, 1, 0, 0, 1]], color: '#f5c542' },
      imageKey: 'docs/u/d/excerpts/a.png',
    });
    expect(parsed.kind).toBe('pdf');
    expect(parsed.pageIndex).toBe(0);
    expect(parsed.geometry?.color).toBe('#f5c542');
    expect(parsed.imageKey).toBe('docs/u/d/excerpts/a.png');
  });

  it('accepts a pdf excerpt using the image quote placeholder', () => {
    const parsed = createAnnotationInputSchema.parse({
      documentId,
      quote: IMAGE_EXCERPT_QUOTE,
      kind: 'pdf',
      pageIndex: 1,
      geometry: { quads: [[10, 20, 40, 20, 40, 50, 10, 50]] },
      imageKey: 'docs/u/d/excerpts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
    });
    expect(parsed.quote).toBe(IMAGE_EXCERPT_QUOTE);
    expect(parsed.imageKey).toContain('/excerpts/');
  });

  it('accepts a media annotation with positionMs', () => {
    const parsed = createAnnotationInputSchema.parse({
      ...base,
      kind: 'media',
      positionMs: 1500,
    });
    expect(parsed.kind).toBe('media');
    expect(parsed.positionMs).toBe(1500);
  });

  it('allows optional anchorBlockIndex on text annotations only', () => {
    const parsed = createAnnotationInputSchema.parse({ ...base, anchorBlockIndex: 2 });
    expect(parsed.anchorBlockIndex).toBe(2);
    expect(
      createAnnotationInputSchema.safeParse({
        ...base,
        kind: 'pdf',
        pageIndex: 0,
        geometry: { quads: [[0, 0, 1, 1]] },
        anchorBlockIndex: 1,
      }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        ...base,
        kind: 'media',
        positionMs: 100,
        anchorBlockIndex: 1,
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty quote for anchored kinds', () => {
    expect(createAnnotationInputSchema.safeParse({ documentId }).success).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({ documentId, quote: '   ' }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        documentId,
        kind: 'pdf',
        pageIndex: 0,
        geometry: { quads: [[0, 0, 1, 1]] },
      }).success,
    ).toBe(false);
  });

  it('accepts a note thought without quote, with note or imageKey', () => {
    const parsed = createAnnotationInputSchema.parse({
      documentId,
      kind: 'note',
      note: '随手一记',
      anchorBlockIndex: 3,
    });
    expect(parsed.kind).toBe('note');
    expect(parsed.quote).toBeUndefined();
    expect(parsed.anchorBlockIndex).toBe(3);

    const imageOnly = createAnnotationInputSchema.parse({
      documentId,
      kind: 'note',
      imageKey: 'users/u/doc-assets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
    });
    expect(imageOnly.imageKey).toContain('/doc-assets/');

    const emptyQuote = createAnnotationInputSchema.parse({
      documentId,
      kind: 'note',
      quote: '  ',
      note: '空白 quote 也算没传',
    });
    expect(emptyQuote.quote).toBe('');
  });

  it('rejects note thoughts without content or with a quote', () => {
    expect(createAnnotationInputSchema.safeParse({ documentId, kind: 'note' }).success).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({ documentId, kind: 'note', note: '  ' }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        documentId,
        kind: 'note',
        quote: '一段原文',
        note: '想法',
      }).success,
    ).toBe(false);
  });

  it('rejects note thoughts carrying anchor-only fields', () => {
    expect(
      createAnnotationInputSchema.safeParse({ documentId, kind: 'note', note: '想', pageIndex: 0 })
        .success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        documentId,
        kind: 'note',
        note: '想',
        geometry: { quads: [[0, 0, 1, 1]] },
      }).success,
    ).toBe(false);
    expect(
      createAnnotationInputSchema.safeParse({
        documentId,
        kind: 'note',
        note: '想',
        positionMs: 100,
      }).success,
    ).toBe(false);
  });
});

describe('excerptUploadInputSchema', () => {
  it('requires a content type and a positive size up to 5MB', () => {
    expect(
      excerptUploadInputSchema.parse({ contentType: 'image/png', sizeBytes: 1024 }).sizeBytes,
    ).toBe(1024);
    expect(
      excerptUploadInputSchema.safeParse({ contentType: 'image/png', sizeBytes: 0 }).success,
    ).toBe(false);
    expect(
      excerptUploadInputSchema.safeParse({
        contentType: 'image/png',
        sizeBytes: 5 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });
});

describe('upsertOcrConfigInputSchema', () => {
  it('defaults model to qwen-vl-ocr and treats apiKey as optional', () => {
    const parsed = upsertOcrConfigInputSchema.parse({});
    expect(parsed.model).toBe('qwen-vl-ocr');
    expect(parsed.apiKey).toBeUndefined();
  });
});
