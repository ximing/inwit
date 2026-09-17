import {
  cardInputFromAnnotation,
  createCardInputSchema,
  IMAGE_EXCERPT_QUOTE,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const ANNOTATION_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_KEY = 'docs/u/d/excerpts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';

describe('createCardInputSchema', () => {
  it('accepts a text card without image fields', () => {
    const parsed = createCardInputSchema.parse({
      documentId: DOCUMENT_ID,
      concept: '梯度消失',
      example: '深层网络里梯度接近 0',
      anchorText: '梯度在反向传播中逐层变小',
    });
    expect(parsed.imageKey).toBeUndefined();
    expect(parsed.anchorBlockIndex).toBeUndefined();
    expect(parsed.annotationId).toBeUndefined();
  });

  it('accepts an excerpt card with imageKey and optional anchorBlockIndex', () => {
    const parsed = createCardInputSchema.parse({
      documentId: DOCUMENT_ID,
      concept: IMAGE_EXCERPT_QUOTE,
      example: '扫描页上的公式',
      anchorText: IMAGE_EXCERPT_QUOTE,
      anchorBlockIndex: 3,
      imageKey: IMAGE_KEY,
    });
    expect(parsed.imageKey).toBe(IMAGE_KEY);
    expect(parsed.anchorBlockIndex).toBe(3);
    expect(parsed.example).toBe('扫描页上的公式');
  });

  it('accepts an optional annotationId for converted cards', () => {
    const parsed = createCardInputSchema.parse({
      documentId: DOCUMENT_ID,
      concept: '梯度消失',
      example: '',
      annotationId: ANNOTATION_ID,
    });
    expect(parsed.annotationId).toBe(ANNOTATION_ID);
  });

  it('rejects an empty concept', () => {
    expect(
      createCardInputSchema.safeParse({
        documentId: DOCUMENT_ID,
        concept: '  ',
        example: '',
      }).success,
    ).toBe(false);
  });
});

describe('cardInputFromAnnotation', () => {
  it('returns null when there is no excerpt image and the note is empty', () => {
    expect(
      cardInputFromAnnotation({
        id: ANNOTATION_ID,
        documentId: DOCUMENT_ID,
        note: '  ',
        quote: '一段原文',
        imageKey: null,
        anchorBlockIndex: 2,
      }),
    ).toBeNull();
  });

  it('converts a plain text annotation: note drives concept/example, quote becomes the anchor', () => {
    expect(
      cardInputFromAnnotation({
        id: ANNOTATION_ID,
        documentId: DOCUMENT_ID,
        note: '这条公式要记\n第二行',
        quote: '原书里的一段公式',
        imageKey: null,
        anchorBlockIndex: 4,
      }),
    ).toEqual({
      documentId: DOCUMENT_ID,
      concept: '这条公式要记',
      example: '这条公式要记\n第二行',
      anchorText: '原书里的一段公式',
      anchorBlockIndex: 4,
      annotationId: ANNOTATION_ID,
    });
  });

  it('drops the anchor when the quote is the excerpt placeholder or empty', () => {
    const parsed = cardInputFromAnnotation({
      id: ANNOTATION_ID,
      documentId: DOCUMENT_ID,
      note: '有想法',
      quote: IMAGE_EXCERPT_QUOTE,
      imageKey: null,
      anchorBlockIndex: null,
    });
    expect(parsed?.anchorText).toBeUndefined();
    expect(parsed?.anchorBlockIndex).toBeUndefined();
  });

  it('keeps the image branch for excerpt annotations', () => {
    expect(
      cardInputFromAnnotation({
        id: ANNOTATION_ID,
        documentId: DOCUMENT_ID,
        note: '这条公式要记\n第二行',
        quote: IMAGE_EXCERPT_QUOTE,
        imageKey: IMAGE_KEY,
        anchorBlockIndex: null,
      }),
    ).toEqual({
      documentId: DOCUMENT_ID,
      concept: '这条公式要记',
      example: '这条公式要记\n第二行',
      anchorText: IMAGE_EXCERPT_QUOTE,
      imageKey: IMAGE_KEY,
      annotationId: ANNOTATION_ID,
    });
  });

  it('falls back to the excerpt placeholder when an excerpt annotation has no note', () => {
    const parsed = cardInputFromAnnotation({
      id: ANNOTATION_ID,
      documentId: DOCUMENT_ID,
      note: '   ',
      quote: IMAGE_EXCERPT_QUOTE,
      imageKey: IMAGE_KEY,
      anchorBlockIndex: null,
    });
    expect(parsed?.concept).toBe(IMAGE_EXCERPT_QUOTE);
    expect(parsed?.example).toBe('   ');
  });
});
