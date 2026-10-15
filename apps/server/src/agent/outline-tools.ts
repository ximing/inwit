import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { applyDocumentMindEdits, placeCanvasMember } from '../canvas/canvas.service.js';
import {
  OUTLINE_L1_MAX,
  OUTLINE_L2_MAX,
  outlineEditsFromTree,
  type OutlineTreeNode,
} from './outline-logic.js';
import type { DigestSession } from './tools.js';

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

const outlineLeafSchema = Type.Object({
  note: Type.String({ minLength: 1, maxLength: 80 }),
  blockIndex: Type.Integer({ minimum: 1, maximum: 999 }),
  quote: Type.String({ minLength: 1, maxLength: 500 }),
});

export const writeOutlineSchema = Type.Object({
  nodes: Type.Array(
    Type.Object({
      note: Type.String({ minLength: 1, maxLength: 80 }),
      blockIndex: Type.Integer({ minimum: 1, maximum: 999 }),
      quote: Type.String({ minLength: 1, maxLength: 500 }),
      children: Type.Optional(Type.Array(outlineLeafSchema, { minItems: 1, maxItems: OUTLINE_L2_MAX })),
    }),
    { minItems: 1, maxItems: OUTLINE_L1_MAX },
  ),
});
export type WriteOutlineArgs = Static<typeof writeOutlineSchema>;

export function writeOutlineTool(session: DigestSession): AgentTool<typeof writeOutlineSchema> {
  return {
    name: 'write_outline',
    label: '建文档大纲',
    description:
      '在文档脑图上建两级大纲，只能调用一次。一级节点是文章标题和各章节，二级节点是章节下 1、2、3 的脉络点。每个节点都是能点回原文的划线：blockIndex 是 read_document 输出里「[块 N | …]」的 N，quote 是该块内逐字抄写的连续原文，note 是脑图上显示的短标题。只有一级节点能有 children。返回每个节点的 nodeId，place_cards 要用。',
    parameters: writeOutlineSchema,
    execute: async (_id, params) => {
      if ((session.outlineNodeIds?.length ?? 0) > 0) {
        return toolResult(JSON.stringify({ ok: false, reason: '大纲已建过，只能建一次' }), {
          ok: false,
        });
      }
      const nodes: OutlineTreeNode[] = params.nodes;
      const plan = outlineEditsFromTree(nodes);
      if (!plan.ok) {
        return toolResult(JSON.stringify({ ok: false, reason: plan.reason }), { ok: false });
      }
      const saved = await applyDocumentMindEdits(session.userId, session.documentId, plan.edits);
      if (!saved.ok) {
        return toolResult(JSON.stringify({ ok: false, reason: saved.reason }), { ok: false });
      }
      const outline = plan.tree.map((entry, i) => {
        const nodeId = saved.created[entry.ref];
        return {
          ref: entry.ref,
          nodeId,
          note: params.nodes[i]?.note ?? '',
          children: entry.childRefs.map((childRef, j) => ({
            ref: childRef,
            nodeId: saved.created[childRef],
            note: params.nodes[i]?.children?.[j]?.note ?? '',
          })),
        };
      });
      const nodeIds = outline
        .flatMap((item) => [item.nodeId, ...item.children.map((child) => child.nodeId)])
        .filter((id): id is string => id !== undefined);
      session.outlineNodeIds = [...(session.outlineNodeIds ?? []), ...nodeIds];
      const payload = { ok: true, outline };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const placeCardsSchema = Type.Object({
  placements: Type.Array(
    Type.Object({
      cardId: Type.String({ minLength: 1, maxLength: 36 }),
      parentId: Type.String({ minLength: 1, maxLength: 36 }),
    }),
    { minItems: 1, maxItems: 40 },
  ),
});
export type PlaceCardsArgs = Static<typeof placeCardsSchema>;

export function placeCardsTool(session: DigestSession): AgentTool<typeof placeCardsSchema> {
  return {
    name: 'place_cards',
    label: '把卡片挂到大纲',
    description:
      '把 write_cards 写出的卡片挂到 write_outline 建的大纲节点下。cardId 必须是本轮 write_cards 返回的 id，parentId 用 write_outline 返回的 nodeId。逐条执行，单条失败不影响其它卡片。',
    parameters: placeCardsSchema,
    execute: async (_id, params) => {
      const placed: string[] = [];
      const failed: { cardId: string; reason: string }[] = [];
      session.placedCardIds = session.placedCardIds ?? [];
      for (const placement of params.placements) {
        if (!session.writtenCardIds.includes(placement.cardId)) {
          failed.push({ cardId: placement.cardId, reason: 'cardId 必须是本轮 write_cards 写出的卡' });
          continue;
        }
        if (session.placedCardIds.includes(placement.cardId)) {
          placed.push(placement.cardId);
          continue;
        }
        try {
          await placeCanvasMember(
            session.userId,
            session.documentId,
            placement.cardId,
            placement.parentId,
          );
          session.placedCardIds.push(placement.cardId);
          placed.push(placement.cardId);
        } catch (err) {
          failed.push({
            cardId: placement.cardId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const payload = { ok: failed.length === 0, placed, failed };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}
