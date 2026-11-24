import { getHeadlessSchema, type PmJson } from '@inwit/doc-schema';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { docEntities } from '@/lib/anchors';
import { buildAnchorDecorations, collectHighlightSegments } from './anchor-highlight';

const OUTLINE_ID = '098a45f2-235c-48c9-89f0-e6bc0cdbdaad';
const CARD_ID = 'c61a722d-5408-4690-9289-9e5c5b8c6d23';

function markedDoc(): PmJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [
          {
            type: 'text',
            text: '一、建立统一的算法问题模型',
            marks: [{ type: 'annotationMark', attrs: { annotationId: OUTLINE_ID } }],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '要强调一个细节',
            marks: [{ type: 'cardAnchor', attrs: { cardIds: [CARD_ID] } }],
          },
        ],
      },
    ],
  };
}

describe('collectHighlightSegments', () => {
  it('paints digest outline marks on their own sentence, not the card below', () => {
    const pm = Node.fromJSON(getHeadlessSchema(), markedDoc());
    const entities = docEntities(
      [{ id: CARD_ID }],
      [{ id: OUTLINE_ID, kind: 'outline', note: '一、建立统一的算法问题模型' }],
    );
    const segments = collectHighlightSegments(pm, entities, null, null).map((segment) => ({
      text: pm.textBetween(segment.from, segment.to),
      cardIds: segment.cardIds,
      annotationIds: segment.annotationIds,
    }));
    expect(segments).toEqual([
      {
        text: '一、建立统一的算法问题模型',
        cardIds: [],
        annotationIds: [OUTLINE_ID],
      },
      {
        text: '要强调一个细节',
        cardIds: [CARD_ID],
        annotationIds: [],
      },
    ]);

    const painted = buildAnchorDecorations(pm, entities, null, null).map((decoration) => {
      const attrs = (decoration as unknown as { attrs?: { class?: string } }).attrs;
      return {
        text: pm.textBetween(decoration.from, decoration.to),
        className: attrs?.class ?? '',
      };
    });
    expect(painted).toEqual([
      { text: '一、建立统一的算法问题模型', className: 'anchor' },
      { text: '要强调一个细节', className: 'anchor' },
    ]);
  });

  it('does not paint pdf or note annotations', () => {
    const pm = Node.fromJSON(getHeadlessSchema(), markedDoc());
    const entities = docEntities(
      [],
      [
        { id: OUTLINE_ID, kind: 'pdf', note: '框' },
        { id: '44444444-4444-4444-8444-444444444444', kind: 'note', note: '想法' },
      ],
    );
    expect(collectHighlightSegments(pm, entities, null, null)).toEqual([]);
  });
});
