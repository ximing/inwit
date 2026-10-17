/** 指针落在哪个概念节点上。后绘制的节点盖在上面，优先命中。 */
export function hitConceptNode(
  point: { x: number; y: number },
  nodes: readonly { id: string; x: number; y: number }[],
  size: { width: number; height: number },
  excludeId?: string,
): string | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!node || node.id === excludeId) continue;
    const inside =
      point.x >= node.x &&
      point.x <= node.x + size.width &&
      point.y >= node.y &&
      point.y <= node.y + size.height;
    if (inside) return node.id;
  }
  return null;
}
