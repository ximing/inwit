import { z } from 'zod';

/** 画布节点。卡片和批注的 id 与原记录相同，文本和图片单独生成。 */
export const CANVAS_NODE_KINDS = ['card', 'annotation', 'text', 'image'] as const;
export const canvasNodeKindSchema = z.enum(CANVAS_NODE_KINDS);
export type CanvasNodeKind = z.infer<typeof canvasNodeKindSchema>;

export const canvasNodeSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  kind: canvasNodeKindSchema,
  cardId: z.string().uuid().nullable(),
  annotationId: z.string().uuid().nullable(),
  text: z.string().nullable(),
  /** Object storage key, not a URL. */
  imageKey: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasNodeListSchema = z.object({
  nodes: z.array(canvasNodeSchema),
});
export type CanvasNodeList = z.infer<typeof canvasNodeListSchema>;

const parentIdField = z.string().uuid().nullable().optional();
const indexField = z.number().int().nonnegative().optional();

export const createCanvasNodeInputSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('text'),
      text: z.string().trim().min(1).max(4000),
      parentId: parentIdField,
      /** 挂到 parentId 下面的第几个。不传则接到末尾。 */
      index: indexField,
    }),
    z.object({
      kind: z.literal('image'),
      imageKey: z.string().trim().min(1).max(512),
      parentId: parentIdField,
      index: indexField,
    }),
  ])
  .refine((value) => value.index === undefined || value.parentId !== undefined);
export type CreateCanvasNodeInput = z.infer<typeof createCanvasNodeInputSchema>;

export const setCanvasNodeInputSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    /** 与 parentId 一起给出时，插到这个下标，而不是接到末尾。 */
    index: z.number().int().nonnegative().optional(),
    text: z.string().trim().min(1).max(4000).optional(),
  })
  .refine(
    (value) =>
      (value.parentId !== undefined || value.text !== undefined) &&
      (value.index === undefined || value.parentId !== undefined),
  );
export type SetCanvasNodeInput = z.infer<typeof setCanvasNodeInputSchema>;

/** 一版脑图里的一行画布。不含卡片正文。 */
export const canvasSnapshotNodeSchema = z.object({
  id: z.string().uuid(),
  kind: canvasNodeKindSchema,
  cardId: z.string().uuid().nullable(),
  annotationId: z.string().uuid().nullable(),
  text: z.string().nullable(),
  imageKey: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  position: z.number().int().nonnegative(),
});
export type CanvasSnapshotNode = z.infer<typeof canvasSnapshotNodeSchema>;

/** 拍快照时还在的批注。恢复会按这份名单把多出来的批注放回回收站。 */
export const canvasSnapshotAnnotationSchema = z.object({
  id: z.string().uuid(),
  note: z.string(),
  imageKey: z.string().nullable(),
});
export type CanvasSnapshotAnnotation = z.infer<typeof canvasSnapshotAnnotationSchema>;

export const canvasSnapshotDocumentSchema = z.object({
  nodes: z.array(canvasSnapshotNodeSchema),
  annotations: z.array(canvasSnapshotAnnotationSchema),
});

/**
 * 旧版只存画布行数组。新版同时记下当时的批注，
 * 这样「加文本」产生的想法才能随版本消失或回来。
 */
export const canvasSnapshotSchema = z.union([
  canvasSnapshotDocumentSchema,
  z.array(canvasSnapshotNodeSchema),
]);
export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;

/** 在脑图上新建一条想法，并在同一次写入里挂到指定位置。 */
export const createCanvasNoteInputSchema = z
  .object({
    note: z.string().trim().max(20_000).optional(),
    imageKey: z.string().trim().min(1).max(512).optional(),
    parentId: parentIdField,
    index: indexField,
  })
  .refine((value) => Boolean(value.note) || Boolean(value.imageKey))
  .refine((value) => value.index === undefined || value.parentId !== undefined);
export type CreateCanvasNoteInput = z.infer<typeof createCanvasNoteInputSchema>;

export const canvasRevisionSchema = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  createdAt: z.string(),
  /** 这一版就是当前脑图。 */
  current: z.boolean(),
});
export type CanvasRevision = z.infer<typeof canvasRevisionSchema>;

export const canvasRevisionListSchema = z.object({
  revisions: z.array(canvasRevisionSchema),
});
export type CanvasRevisionList = z.infer<typeof canvasRevisionListSchema>;

export type CanvasMember = {
  id: string;
  kind: CanvasNodeKind;
  parentId: string | null;
  position: number;
};

export type CanvasForestSource = {
  id: string;
  kind: CanvasNodeKind;
  cardId: string | null;
  annotationId: string | null;
  parentId: string | null;
  position: number;
};

/**
 * 可见的卡片、批注，加上已经落库的文本和图片。
 * 还没有画布行的卡片和批注是根。父节点不在这片林子里时，也当作根，库里的 parent 仍保留。
 */
export function mergeCanvasForest(
  cardIds: readonly string[],
  annotationIds: readonly string[],
  nodes: readonly CanvasForestSource[],
): CanvasMember[] {
  const cards = new Set(cardIds);
  const notes = new Set(annotationIds);
  const members: CanvasMember[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (node.kind === 'card') {
      if (!node.cardId || node.id !== node.cardId || !cards.has(node.cardId)) continue;
    } else if (node.kind === 'annotation') {
      if (!node.annotationId || node.id !== node.annotationId || !notes.has(node.annotationId)) continue;
    } else if (node.kind !== 'text' && node.kind !== 'image') {
      continue;
    }
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    members.push({
      id: node.id,
      kind: node.kind,
      parentId: node.parentId,
      position: node.position,
    });
  }

  for (const id of cardIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    members.push({ id, kind: 'card', parentId: null, position: 0 });
  }
  for (const id of annotationIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    members.push({ id, kind: 'annotation', parentId: null, position: 0 });
  }

  const ids = new Set(members.map((member) => member.id));
  return members.map((member) => ({
    ...member,
    parentId:
      member.parentId && ids.has(member.parentId) && member.parentId !== member.id
        ? member.parentId
        : null,
  }));
}
