import type { CanvasMember, CardLinkType } from '@inwit/dto';

export type TopicGraphEdge = { from: string; to: string; type: CardLinkType };

/**
 * 主题脑图的结构：连通分量内 BFS 生成一棵树（树边画成父子连线），
 * 没被生成树用掉的关联留下画类型化虚线。卡片顺序即传入顺序（服务端按创建时间）。
 * 树边本身也是知识关联，类型经 treeTypes（key 是子节点）带出去着色。
 */
export function topicGraphForest(
  cardIds: readonly string[],
  links: readonly { fromCardId: string; toCardId: string; type: CardLinkType }[],
): {
  members: CanvasMember[];
  relations: TopicGraphEdge[];
  treeTypes: ReadonlyMap<string, CardLinkType>;
} {
  const ids = cardIds.filter((id, index) => cardIds.indexOf(id) === index);
  const idSet = new Set(ids);
  const adjacency = new Map<string, { id: string; linkIndex: number }[]>();
  links.forEach((link, linkIndex) => {
    if (!idSet.has(link.fromCardId) || !idSet.has(link.toCardId)) return;
    if (link.fromCardId === link.toCardId) return;
    const out = adjacency.get(link.fromCardId) ?? [];
    out.push({ id: link.toCardId, linkIndex });
    adjacency.set(link.fromCardId, out);
    const back = adjacency.get(link.toCardId) ?? [];
    back.push({ id: link.fromCardId, linkIndex });
    adjacency.set(link.toCardId, back);
  });

  const parentOf = new Map<string, string | null>();
  const positionOf = new Map<string, number>();
  const treeTypes = new Map<string, CardLinkType>();
  const treeLinks = new Set<number>();
  for (const root of ids) {
    if (parentOf.has(root)) continue;
    parentOf.set(root, null);
    const queue = [root];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head] as string;
      let position = 0;
      for (const { id, linkIndex } of adjacency.get(current) ?? []) {
        if (parentOf.has(id)) continue;
        parentOf.set(id, current);
        positionOf.set(id, position);
        position += 1;
        treeLinks.add(linkIndex);
        treeTypes.set(id, links[linkIndex]?.type ?? 'related');
        queue.push(id);
      }
    }
  }

  const members: CanvasMember[] = ids.map((id, index) => ({
    id,
    kind: 'card',
    parentId: parentOf.get(id) ?? null,
    position: positionOf.get(id) ?? index,
  }));
  const relations = links
    .map((link, linkIndex) => ({ link, linkIndex }))
    .filter(
      ({ link, linkIndex }) =>
        !treeLinks.has(linkIndex) &&
        idSet.has(link.fromCardId) &&
        idSet.has(link.toCardId) &&
        link.fromCardId !== link.toCardId,
    )
    .map(({ link }) => ({ from: link.fromCardId, to: link.toCardId, type: link.type }));
  return { members, relations, treeTypes };
}
