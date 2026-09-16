import {
  applyEntityAnchor,
  getHeadlessSchema,
  type PmJson,
} from '@inwit/doc-schema';
import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { blockIndexAt, isLostTextEntity, missingTextEntities } from './entity-marks';

function doc(...content: PmJson[]): PmJson {
  return { type: 'doc', content };
}

function p(text: string): PmJson {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const CARD_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';

const source = doc(p('hello world'), p('second block'));

describe('missingTextEntities', () => {
  it('lists cards/notes that have blockIndex+quote but no mark', () => {
    expect(
      missingTextEntities(
        source,
        [{ id: CARD_ID, anchorText: 'hello', anchorBlockIndex: 1 }],
        [{ id: NOTE_ID, kind: 'text', quote: 'second', anchorBlockIndex: 2 }],
      ),
    ).toEqual([
      { kind: 'card', id: CARD_ID, blockIndex: 1, quote: 'hello' },
      { kind: 'annotation', id: NOTE_ID, blockIndex: 2, quote: 'second' },
    ]);
  });

  it('skips excerpt cards and entities that already have marks', () => {
    const marked = applyEntityAnchor(source, 'card', CARD_ID, { from: 1, to: 6 });
    expect(
      missingTextEntities(
        marked,
        [
          { id: CARD_ID, anchorText: 'hello', anchorBlockIndex: 1 },
          { id: '33333333-3333-4333-8333-333333333333', anchorText: IMAGE_EXCERPT_QUOTE, anchorBlockIndex: 1 },
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe('isLostTextEntity', () => {
  it('is lost when quote cannot be located and no mark exists', () => {
    expect(
      isLostTextEntity(source, {
        id: CARD_ID,
        kind: 'card',
        quote: 'not in the doc',
        blockIndex: 1,
      }),
    ).toBe(true);
  });

  it('is not lost when locate would succeed even without a mark yet', () => {
    expect(
      isLostTextEntity(source, {
        id: CARD_ID,
        kind: 'card',
        quote: 'hello',
        blockIndex: 1,
      }),
    ).toBe(false);
  });

  it('is not lost for pdf annotations or image excerpts', () => {
    expect(
      isLostTextEntity(source, {
        id: NOTE_ID,
        kind: 'annotation',
        annotationKind: 'pdf',
        quote: IMAGE_EXCERPT_QUOTE,
      }),
    ).toBe(false);
    expect(
      isLostTextEntity(source, {
        id: CARD_ID,
        kind: 'card',
        quote: IMAGE_EXCERPT_QUOTE,
        hasImage: true,
      }),
    ).toBe(false);
  });
});

describe('blockIndexAt', () => {
  it('returns 1-based top-level index', () => {
    const pm = Node.fromJSON(getHeadlessSchema(), source);
    expect(blockIndexAt(pm, 1)).toBe(1);
    const second = source.content?.[1];
    expect(second).toBeTruthy();
    // pos of first text in second paragraph = 1 (first p) + 2 (open+close?) ...
    let pos = -1;
    pm.descendants((node, at) => {
      if (pos < 0 && node.isText && node.text === 'second block') pos = at;
    });
    expect(pos).toBeGreaterThan(0);
    expect(blockIndexAt(pm, pos)).toBe(2);
  });
});
