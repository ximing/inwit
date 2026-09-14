import { describe, expect, it } from 'vitest';
import { topicJobPayloadFrom, topicJobPayloadSchema } from '@inwit/dto';
import {
  collectOutlineAttachments,
  droppedAttachments,
  flattenOutline,
  OutlineError,
  parsePlaceOnMapTarget,
} from './outline.js';
import { flattenMapTree } from './tree.js';

describe('flattenOutline', () => {
  it('flattens three levels with positions and parent keys', () => {
    const flat = flattenOutline([
      {
        title: '基础',
        children: [
          {
            title: '训练',
            children: [{ title: '梯度消失', cardIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] }],
          },
        ],
      },
      { title: '正则化', uncovered: true },
    ]);
    expect(flat.map((node) => node.title)).toEqual(['基础', '训练', '梯度消失', '正则化']);
    expect(flat.map((node) => node.depth)).toEqual([1, 2, 3, 1]);
    expect(flat[2]?.parentKey).toBe(flat[1]?.key);
    expect(flat[3]?.uncovered).toBe(true);
  });

  it('rejects a fourth level', () => {
    expect(() =>
      flattenOutline([
        {
          title: 'a',
          children: [{ title: 'b', children: [{ title: 'c', children: [{ title: 'd' }] }] }],
        },
      ]),
    ).toThrow(OutlineError);
  });

  it('rejects duplicate card placement and empty titles', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    expect(() =>
      flattenOutline([
        { title: 'a', cardIds: [id] },
        { title: 'b', cardIds: [id] },
      ]),
    ).toThrow(/多个节点/);
    expect(() => flattenOutline([{ title: '   ' }])).toThrow(OutlineError);
  });

  it('rejects uncovered nodes that still hang cards', () => {
    expect(() =>
      flattenOutline([
        {
          title: '缺口',
          uncovered: true,
          cardIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
        },
      ]),
    ).toThrow(/空白节点/);
  });
});

describe('droppedAttachments', () => {
  it('reports previously attached cards/docs missing from the next tree', () => {
    const flat = flattenOutline([
      { title: '留下', cardIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] },
    ]);
    const next = collectOutlineAttachments(flat);
    const dropped = droppedAttachments({
      previouslyAttachedCardIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      ],
      previouslyAttachedDocumentIds: ['cccccccc-cccc-4ccc-8ccc-ccccccccccc3'],
      nextCardIds: next.cardIds,
      nextDocumentIds: next.documentIds,
    });
    expect(dropped.cards).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']);
    expect(dropped.documents).toEqual(['cccccccc-cccc-4ccc-8ccc-ccccccccccc3']);
  });

  it('allows moving a card to another node', () => {
    const flat = flattenOutline([
      { title: '新家', cardIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] },
    ]);
    const next = collectOutlineAttachments(flat);
    const dropped = droppedAttachments({
      previouslyAttachedCardIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
      previouslyAttachedDocumentIds: [],
      nextCardIds: next.cardIds,
      nextDocumentIds: next.documentIds,
    });
    expect(dropped.cards).toEqual([]);
  });
});

describe('parsePlaceOnMapTarget', () => {
  it('accepts nodeId xor newNode', () => {
    expect(
      parsePlaceOnMapTarget({ nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }),
    ).toEqual({ kind: 'existing', nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' });
    expect(parsePlaceOnMapTarget({ newNode: { title: '正则化' } })).toEqual({
      kind: 'new',
      title: '正则化',
      parentId: null,
    });
    expect(() => parsePlaceOnMapTarget({})).toThrow(OutlineError);
    expect(() =>
      parsePlaceOnMapTarget({
        nodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        newNode: { title: 'x' },
      }),
    ).toThrow(OutlineError);
  });
});

describe('topicJobPayloadSchema', () => {
  it('requires nodeId for fill and accepts organize', () => {
    expect(
      topicJobPayloadSchema.safeParse({
        topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        action: 'organize',
      }).success,
    ).toBe(true);
    expect(
      topicJobPayloadSchema.safeParse({
        topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        action: 'fill',
      }).success,
    ).toBe(false);
    expect(
      topicJobPayloadFrom({
        topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        action: 'fill',
        nodeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        documentId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      })?.action,
    ).toBe('fill');
    expect(topicJobPayloadFrom({ action: 'organize' })).toBeUndefined();
  });
});

describe('flattenMapTree', () => {
  it('builds slash paths and depths', () => {
    const at = '2026-09-14T00:00:00.000Z';
    const topicId = '11111111-1111-4111-8111-111111111111';
    const tree = flattenMapTree([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        topicId,
        parentId: null,
        title: '基础概念',
        status: 'uncovered',
        note: null,
        position: 0,
        createdAt: at,
        cardCount: 0,
        docCount: 0,
        mastery: 0,
        children: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
            topicId,
            parentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            title: '训练问题',
            status: 'learning',
            note: null,
            position: 0,
            createdAt: at,
            cardCount: 1,
            docCount: 0,
            mastery: 0,
            children: [],
          },
        ],
      },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.path).toBe('基础概念');
    expect(tree[0]?.depth).toBe(1);
    expect(tree[1]?.path).toBe('基础概念 / 训练问题');
    expect(tree[1]?.depth).toBe(2);
  });
});
