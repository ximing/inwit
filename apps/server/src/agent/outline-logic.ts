import type { MindEditInput } from '../canvas/mind-edit-logic.js';

/** 一级大纲节点上限。 */
export const OUTLINE_L1_MAX = 12;
/** 每个一级节点下的二级节点上限。 */
export const OUTLINE_L2_MAX = 8;
/** 大纲节点总数上限。 */
export const OUTLINE_TOTAL_MAX = 60;

export type OutlineTreeNode = {
  /** 脑图上显示的短标题。 */
  note: string;
  /** quote 所在块的序号（read_document 的「块 N」，从 1 计）。 */
  blockIndex: number;
  /** 该块内逐字抄写的原文。 */
  quote: string;
  /** 仅一级节点可有二级子节点。 */
  children?: OutlineTreeNode[];
};

export type OutlineEditPlan =
  | {
      ok: true;
      edits: MindEditInput[];
      /** 与输入同序的一级 ref 及其二级子 ref，用来把落库 id 重组回树。 */
      tree: { ref: string; childRefs: string[] }[];
    }
  | { ok: false; reason: string };

/**
 * 把两级大纲树扁平化成一批 create_highlight 脑图编辑（kind='outline'）。
 * 一级 ref 是 s1..sN，二级是 s1-1..（ref 要求字母开头）。
 */
export function outlineEditsFromTree(nodes: readonly OutlineTreeNode[]): OutlineEditPlan {
  if (nodes.length === 0) return { ok: false, reason: '至少要一个大纲节点' };
  if (nodes.length > OUTLINE_L1_MAX) {
    return { ok: false, reason: `一级大纲节点最多 ${String(OUTLINE_L1_MAX)} 个` };
  }
  let total = nodes.length;
  for (const node of nodes) {
    const children = node.children ?? [];
    if (children.length > OUTLINE_L2_MAX) {
      return { ok: false, reason: `每个一级节点下最多 ${String(OUTLINE_L2_MAX)} 个二级节点` };
    }
    if (children.some((child) => (child.children?.length ?? 0) > 0)) {
      return { ok: false, reason: '大纲只有两级，二级节点不能再有子节点' };
    }
    total += children.length;
  }
  if (total > OUTLINE_TOTAL_MAX) {
    return { ok: false, reason: `大纲节点总数最多 ${String(OUTLINE_TOTAL_MAX)} 个` };
  }

  const edits: MindEditInput[] = [];
  const tree: { ref: string; childRefs: string[] }[] = [];
  nodes.forEach((node, i) => {
    const ref = `s${String(i + 1)}`;
    const childRefs: string[] = [];
    edits.push({
      op: 'create_highlight',
      ref,
      note: node.note,
      blockIndex: node.blockIndex,
      quote: node.quote,
      index: i,
      kind: 'outline',
    });
    (node.children ?? []).forEach((child, j) => {
      const childRef = `${ref}-${String(j + 1)}`;
      childRefs.push(childRef);
      edits.push({
        op: 'create_highlight',
        ref: childRef,
        note: child.note,
        blockIndex: child.blockIndex,
        quote: child.quote,
        parentRef: ref,
        index: j,
        kind: 'outline',
      });
    });
    tree.push({ ref, childRefs });
  });
  return { ok: true, edits, tree };
}
