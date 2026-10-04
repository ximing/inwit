import type { CardLinkType } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { topicGraphForest } from './topic-graph-logic';

const link = (fromCardId: string, toCardId: string, type: CardLinkType = 'related') => ({
  fromCardId,
  toCardId,
  type,
});

describe('topicGraphForest', () => {
  it('连通分量生成一棵树，剩下的关联留作虚线边', () => {
    // a-b-c 一条链，外加 a-c 成环；d 独立。BFS 从 a 同时发现 b 和 c。
    const { members, relations, treeTypes } = topicGraphForest(
      ['a', 'b', 'c', 'd'],
      [link('a', 'b'), link('b', 'c'), link('a', 'c', 'confusable')],
    );
    const parentOf = new Map(members.map((member) => [member.id, member.parentId]));
    expect(parentOf.get('a')).toBeNull();
    expect(parentOf.get('d')).toBeNull();
    expect(parentOf.get('b')).toBe('a');
    expect(parentOf.get('c')).toBe('a');
    // 环上没被生成树用掉的 b-c 边留作关系边。
    expect(relations).toEqual([{ from: 'b', to: 'c', type: 'related' }]);
    // 树边带出关联类型：a→b 是 related，a→c 是 confusable。
    expect(treeTypes.get('b')).toBe('related');
    expect(treeTypes.get('c')).toBe('confusable');
  });

  it('树里用过的关联不再重复画虚线', () => {
    const { relations } = topicGraphForest(['a', 'b'], [link('a', 'b')]);
    expect(relations).toEqual([]);
  });

  it('忽略指向集合外的关联和自环', () => {
    const { members, relations } = topicGraphForest(
      ['a', 'b'],
      [link('a', 'x'), link('a', 'a'), link('a', 'b')],
    );
    expect(members).toHaveLength(2);
    expect(relations).toEqual([]);
  });

  it('没有关联时每张卡自成一棵树', () => {
    const { members, relations } = topicGraphForest(['a', 'b', 'c'], []);
    expect(members.every((member) => member.parentId === null)).toBe(true);
    expect(relations).toEqual([]);
  });

  it('兄弟位置按 BFS 发现顺序，根保持传入顺序', () => {
    const { members } = topicGraphForest(
      ['r', 'a', 'b', 'c'],
      [link('r', 'a'), link('r', 'b'), link('r', 'c')],
    );
    const kids = members
      .filter((member) => member.parentId === 'r')
      .sort((x, y) => x.position - y.position)
      .map((member) => member.id);
    expect(kids).toEqual(['a', 'b', 'c']);
  });
});
