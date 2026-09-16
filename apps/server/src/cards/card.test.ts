import {
  createCardInputSchema,
  excerptCardInputFromAnnotation,
  IMAGE_EXCERPT_QUOTE,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
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

describe('excerptCardInputFromAnnotation', () => {
  it('returns null when the annotation has no excerpt key', () => {
    expect(
      excerptCardInputFromAnnotation({
        documentId: DOCUMENT_ID,
        note: '一条想法',
        pageIndex: 2,
        imageKey: null,
      }),
    ).toBeNull();
  });

  it('uses the note as example and quote placeholder as anchor, without a block index', () => {
    expect(
      excerptCardInputFromAnnotation({
        documentId: DOCUMENT_ID,
        note: '这条公式要记\n第二行',
        pageIndex: 2,
        imageKey: IMAGE_KEY,
      }),
    ).toEqual({
      documentId: DOCUMENT_ID,
      concept: '这条公式要记',
      example: '这条公式要记\n第二行',
      anchorText: IMAGE_EXCERPT_QUOTE,
      imageKey: IMAGE_KEY,
    });
  });

  it('falls back to the excerpt placeholder when the note is empty', () => {
    const parsed = excerptCardInputFromAnnotation({
      documentId: DOCUMENT_ID,
      note: '   ',
      pageIndex: 0,
      imageKey: IMAGE_KEY,
    });
    expect(parsed?.concept).toBe(IMAGE_EXCERPT_QUOTE);
    expect(parsed?.example).toBe('   ');
    expect(parsed?.anchorBlockIndex).toBeUndefined();
  });
});
