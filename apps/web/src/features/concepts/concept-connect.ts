/** 指针落在哪个概念节点上。后绘制的节点盖在上面，优先命中。节点自带宽高时按各自的盒子算。 */
export function hitConceptNode(
  point: { x: number; y: number },
  nodes: readonly { id: string; x: number; y: number; width?: number; height?: number }[],
  size: { width: number; height: number },
  excludeId?: string,
): string | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!node || node.id === excludeId) continue;
    const width = node.width ?? size.width;
    const height = node.height ?? size.height;
    const inside =
      point.x >= node.x &&
      point.x <= node.x + width &&
      point.y >= node.y &&
      point.y <= node.y + height;
    if (inside) return node.id;
  }
  return null;
}
