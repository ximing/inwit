import { describe, expect, it } from 'vitest';
import {
  createMapNodeInputSchema,
  mapNodeSchema,
  mapSummarySchema,
  mapTreeSchema,
  setMapNodeInputSchema,
  updateMapNodeInputSchema,
} from '@inwit/dto';
import {
  COVERED_MASTERY_THRESHOLD,
  cardMastery,
  masteryPct,
  nodeMastery,
  statusFromMastery,
} from './mastery.js';
import {
  assembleMapTree,
  depthFromRoot,
  parentChainContains,
  subtreeRelativeHeight,
} from './tree.js';

describe('cardMastery / nodeMastery', () => {
  it('counts only remembered as 1; unreviewed/forgot/fuzzy as 0', () => {
    expect(cardMastery('remembered')).toBe(1);
    expect(cardMastery('forgot')).toBe(0);
    expect(cardMastery('fuzzy')).toBe(0);
    expect(cardMastery(null)).toBe(0);
    expect(cardMastery(undefined)).toBe(0);
  });

  it('averages across cards; empty node is 0', () => {
    expect(nodeMastery([])).toBe(0);
    expect(nodeMastery(['remembered'])).toBe(1);
    expect(nodeMastery(['remembered', 'forgot'])).toBe(0.5);
    expect(nodeMastery(['remembered', 'remembered', 'remembered', null])).toBe(0.75);
    expect(nodeMastery(['remembered', 'remembered', 'remembered', 'remembered', 'forgot'])).toBe(
      0.8,
    );
  });
});

describe('statusFromMastery', () => {
  it('uncovered when there are no cards', () => {
    expect(statusFromMastery(0, 0)).toBe('uncovered');
    expect(statusFromMastery(0, 1)).toBe('uncovered');
  });

  it('covered at the 80% remembered threshold, otherwise learning', () => {
    expect(COVERED_MASTERY_THRESHOLD).toBe(0.8);
    expect(statusFromMastery(5, 0.8)).toBe('covered');
    expect(statusFromMastery(4, 0.75)).toBe('learning');
    expect(statusFromMastery(1, 0)).toBe('learning');
    expect(statusFromMastery(1, 1)).toBe('covered');
  });
});

describe('masteryPct', () => {
  it('rounds the remembered ratio to 0–100', () => {
    expect(masteryPct([])).toBe(0);
    expect(masteryPct(['remembered', 'forgot', 'forgot'])).toBe(33);
    expect(masteryPct(['remembered', 'remembered'])).toBe(100);
  });
});

describe('assembleMapTree', () => {
  const t = '11111111-1111-4111-8111-111111111111';
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const c = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const at = '2026-09-14T00:00:00.000Z';

  function node(
    id: string,
    parentId: string | null,
    position: number,
    title: string,
  ) {
    return {
      id,
      topicId: t,
      parentId,
      title,
      status: 'uncovered' as const,
      note: null,
      position,
      createdAt: at,
      cardCount: 0,
      proposedCount: 0,
      docCount: 0,
      mastery: 0,
    };
  }

  it('nests children and sorts siblings by position then id', () => {
    const tree = assembleMapTree([
      node(c, a, 1, 'c'),
      node(b, a, 0, 'b'),
      node(a, null, 0, 'a'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe(a);
    expect(tree[0]?.children.map((n) => n.id)).toEqual([b, c]);
    expect(tree[0]?.children[0]?.children).toEqual([]);
  });
});

describe('tree helpers', () => {
  it('computes depth, relative height, and cycle detection', () => {
    const parentOf = new Map<string, string | null>([
      ['root', null],
      ['mid', 'root'],
      ['leaf', 'mid'],
    ]);
    const childrenOf = new Map<string, { id: string }[]>([
      ['root', [{ id: 'mid' }]],
      ['mid', [{ id: 'leaf' }]],
    ]);
    expect(depthFromRoot('root', parentOf)).toBe(1);
    expect(depthFromRoot('mid', parentOf)).toBe(2);
    expect(depthFromRoot('leaf', parentOf)).toBe(3);
    expect(subtreeRelativeHeight('leaf', childrenOf)).toBe(0);
    expect(subtreeRelativeHeight('mid', childrenOf)).toBe(1);
    expect(subtreeRelativeHeight('root', childrenOf)).toBe(2);
    expect(parentChainContains('root', 'leaf', parentOf)).toBe(false);
    expect(parentChainContains('leaf', 'root', parentOf)).toBe(true);
    expect(parentChainContains('mid', 'root', parentOf)).toBe(true);
    expect(parentChainContains('leaf', 'mid', parentOf)).toBe(true);
  });
});

describe('map dto schemas', () => {
  it('accepts create / update / set-node bodies', () => {
    expect(createMapNodeInputSchema.safeParse({ title: '正则化' }).success).toBe(true);
    expect(
      createMapNodeInputSchema.safeParse({
        title: 'L2',
        parentId: '11111111-1111-4111-8111-111111111111',
        note: '还没学',
      }).success,
    ).toBe(true);
    expect(updateMapNodeInputSchema.safeParse({}).success).toBe(false);
    expect(updateMapNodeInputSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(setMapNodeInputSchema.safeParse({ nodeId: null }).success).toBe(true);
    expect(setMapNodeInputSchema.safeParse({}).success).toBe(false);
  });

  it('parses a nested MapTree and MapSummary', () => {
    const node = {
      id: '11111111-1111-4111-8111-111111111111',
      topicId: '11111111-1111-4111-8111-111111111112',
      parentId: null,
      title: '基础概念',
      status: 'learning',
      note: null,
      position: 0,
      createdAt: '2026-09-14T00:00:00.000Z',
      cardCount: 2,
      proposedCount: 0,
      docCount: 1,
      mastery: 0.5,
      children: [],
    };
    expect(mapNodeSchema.safeParse({ ...node, children: undefined }).success).toBe(true);
    expect(mapTreeSchema.safeParse({ nodes: [node] }).success).toBe(true);
    expect(
      mapSummarySchema.safeParse({
        totalNodes: 9,
        uncoveredNodes: 4,
        cardCount: 12,
        masteryPct: 62,
      }).success,
    ).toBe(true);
  });
});
