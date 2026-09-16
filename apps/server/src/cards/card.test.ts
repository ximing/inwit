import {
  createCardInputSchema,
  excerptCardInputFromAnnotation,
  IMAGE_EXCERPT_QUOTE,
  pageIndexToAnchorBlock,
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
    expect(parsed.anchorBlock).toBeUndefined();
  });

  it('accepts an excerpt card with imageKey and 1-based anchorBlock', () => {
    const parsed = createCardInputSchema.parse({
      documentId: DOCUMENT_ID,
      concept: IMAGE_EXCERPT_QUOTE,
      example: '扫描页上的公式',
      anchorText: IMAGE_EXCERPT_QUOTE,
      anchorBlock: '3',
      imageKey: IMAGE_KEY,
    });
    expect(parsed.imageKey).toBe(IMAGE_KEY);
    expect(parsed.anchorBlock).toBe('3');
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

describe('pageIndexToAnchorBlock', () => {
  it('maps a 0-based page index to a 1-based block string', () => {
    expect(pageIndexToAnchorBlock(0)).toBe('1');
    expect(pageIndexToAnchorBlock(2)).toBe('3');
    expect(pageIndexToAnchorBlock(-1)).toBe('1');
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

  it('uses the note as example, quote placeholder as anchor, and page as block', () => {
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
      anchorBlock: '3',
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
    expect(parsed?.anchorBlock).toBe('1');
  });
});
