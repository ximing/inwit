export const TOPIC_EDIT_MAX = 16;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const OPS = [
  'create_topic',
  'update_topic',
  'assign_document',
  'create_node',
  'rename_node',
  'move_node',
  'delete_node',
  'place_document',
  'place_card',
] as const;

export type TopicEditOp = (typeof OPS)[number];

export interface TopicEditDraft {
  op: string;
  ref?: string;
  topicId?: string | null;
  topicRef?: string;
  documentId?: string;
  cardId?: string;
  nodeId?: string | null;
  nodeRef?: string;
  parentId?: string | null;
  parentRef?: string;
  title?: string;
  goal?: string | null;
  note?: string | null;
}

export type PlannedTopicEdit =
  | { op: 'create_topic'; ref: string; title: string; goal?: string }
  | { op: 'update_topic'; topicId: string; title?: string; goal?: string | null }
  | { op: 'assign_document'; documentId: string; topicId: string | null; topicRef?: string }
  | {
      op: 'create_node';
      ref: string;
      title: string;
      topicId?: string;
      topicRef?: string;
      parentId: string | null;
      parentRef?: string;
      note?: string;
    }
  | { op: 'rename_node'; nodeId: string; title?: string; note?: string | null }
  | { op: 'move_node'; nodeId: string; parentId: string | null; parentRef?: string }
  | { op: 'delete_node'; nodeId: string }
  | { op: 'place_document'; documentId: string; nodeId: string | null; nodeRef?: string }
  | { op: 'place_card'; cardId: string; nodeId: string | null; nodeRef?: string };

export type TopicEditPlan =
  | { ok: true; edits: PlannedTopicEdit[] }
  | { ok: false; reason: string };

class PlanError extends Error {}

function step(index: number, reason: string): string {
  return `第 ${String(index + 1)} 步：${reason}`;
}

function bad(index: number, reason: string): never {
  throw new PlanError(step(index, reason));
}

function isOp(value: string): value is TopicEditOp {
  return (OPS as readonly string[]).includes(value);
}

function requiredRef(value: string | undefined, index: number): string {
  const ref = value?.trim() ?? '';
  if (!REF_RE.test(ref)) bad(index, '临时编号要用字母开头，只含字母、数字、下划线或短横线');
  return ref;
}

function requiredUuid(value: string | null | undefined, index: number, label: string): string {
  const id = value?.trim() ?? '';
  if (!UUID_RE.test(id)) bad(index, `${label}不合法`);
  return id;
}

function requiredTitle(value: string | undefined, index: number): string {
  const title = value?.trim() ?? '';
  if (!title) bad(index, '标题不能为空');
  if (title.length > 200) bad(index, '标题最多 200 字');
  return title;
}

function optionalTitle(value: string | undefined, index: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredTitle(value, index);
}

function optionalGoal(
  value: string | null | undefined,
  index: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const goal = value.trim();
  if (goal.length > 4000) bad(index, '目标最多 4000 字');
  return goal.length > 0 ? goal : null;
}

function optionalNote(
  value: string | null | undefined,
  index: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const note = value.trim();
  if (note.length > 4000) bad(index, '笔记最多 4000 字');
  return note.length > 0 ? note : null;
}

function claim(seen: Set<string>, key: string, index: number, reason: string): void {
  if (seen.has(key)) bad(index, reason);
  seen.add(key);
}

/** Normalize one batch. Refs only point at earlier creates in this batch. */
export function planTopicEdits(edits: readonly TopicEditDraft[]): TopicEditPlan {
  if (edits.length === 0) return { ok: false, reason: '没有要调整的内容' };
  if (edits.length > TOPIC_EDIT_MAX) {
    return { ok: false, reason: `一次最多调整 ${String(TOPIC_EDIT_MAX)} 步` };
  }
  try {
    const planned: PlannedTopicEdit[] = [];
    const refs = new Map<string, 'topic' | 'node'>();
    const updatedTopics = new Set<string>();
    const assignedDocs = new Set<string>();
    const placedDocs = new Set<string>();
    const placedCards = new Set<string>();
    const renamedNodes = new Set<string>();
    const movedNodes = new Set<string>();
    const deletedNodes = new Set<string>();

    const liveNode = (id: string, index: number, label: string) => {
      if (deletedNodes.has(id)) bad(index, `这个${label}在这一批里已经删掉`);
    };

    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index];
      if (!edit || !isOp(edit.op)) bad(index, '不认识这个操作');
      switch (edit.op) {
        case 'create_topic': {
          const ref = requiredRef(edit.ref, index);
          if (refs.has(ref)) bad(index, '临时编号重复了');
          const title = requiredTitle(edit.title, index);
          const goal = optionalGoal(edit.goal, index);
          refs.set(ref, 'topic');
          planned.push({
            op: 'create_topic',
            ref,
            title,
            ...(goal ? { goal } : {}),
          });
          break;
        }
        case 'update_topic': {
          const topicId = requiredUuid(edit.topicId, index, '主题编号');
          claim(updatedTopics, topicId, index, '同一个主题不要在一批里改两次');
          const title = optionalTitle(edit.title, index);
          const goal = optionalGoal(edit.goal, index);
          if (title === undefined && goal === undefined) bad(index, '要写标题或目标');
          planned.push({
            op: 'update_topic',
            topicId,
            ...(title !== undefined ? { title } : {}),
            ...(goal !== undefined ? { goal } : {}),
          });
          break;
        }
        case 'assign_document': {
          const documentId = requiredUuid(edit.documentId, index, '文档编号');
          claim(assignedDocs, documentId, index, '同一篇文档不要在一批里改两次归属');
          const hasRef = edit.topicRef !== undefined && edit.topicRef.trim().length > 0;
          const hasId = edit.topicId !== undefined;
          if (hasRef === hasId) bad(index, '归属要写 topicId 或 topicRef 里的一个');
          if (hasRef) {
            const topicRef = requiredRef(edit.topicRef, index);
            if (refs.get(topicRef) !== 'topic') bad(index, '主题要指向本批更早新建的主题');
            planned.push({ op: 'assign_document', documentId, topicId: null, topicRef });
            break;
          }
          const topicId =
            edit.topicId === null ? null : requiredUuid(edit.topicId, index, '主题编号');
          planned.push({ op: 'assign_document', documentId, topicId });
          break;
        }
        case 'create_node': {
          const ref = requiredRef(edit.ref, index);
          if (refs.has(ref)) bad(index, '临时编号重复了');
          const title = requiredTitle(edit.title, index);
          const hasTopicRef = edit.topicRef !== undefined && edit.topicRef.trim().length > 0;
          const hasTopicId = edit.topicId !== undefined && edit.topicId !== null;
          if (hasTopicRef === hasTopicId) bad(index, '新节点要写 topicId 或 topicRef 里的一个');
          if (edit.topicId === null) bad(index, '新节点要写 topicId 或 topicRef 里的一个');
          let topicId: string | undefined;
          let topicRef: string | undefined;
          if (hasTopicRef) {
            topicRef = requiredRef(edit.topicRef, index);
            if (refs.get(topicRef) !== 'topic') bad(index, '主题要指向本批更早新建的主题');
          } else {
            topicId = requiredUuid(edit.topicId, index, '主题编号');
          }
          const hasParentRef = edit.parentRef !== undefined && edit.parentRef.trim().length > 0;
          const hasParentId = edit.parentId !== undefined;
          if (hasParentRef && hasParentId) bad(index, '不要同时写 parentId 和 parentRef');
          let parentId: string | null = null;
          let parentRef: string | undefined;
          if (hasParentRef) {
            parentRef = requiredRef(edit.parentRef, index);
            if (refs.get(parentRef) !== 'node') bad(index, '父节点要指向本批更早新建的节点');
          } else if (typeof edit.parentId === 'string') {
            parentId = requiredUuid(edit.parentId, index, '父节点编号');
            liveNode(parentId, index, '父节点');
          }
          const note = optionalNote(edit.note, index);
          refs.set(ref, 'node');
          planned.push({
            op: 'create_node',
            ref,
            title,
            parentId,
            ...(topicId ? { topicId } : {}),
            ...(topicRef ? { topicRef } : {}),
            ...(parentRef ? { parentRef } : {}),
            ...(note ? { note } : {}),
          });
          break;
        }
        case 'rename_node': {
          const nodeId = requiredUuid(edit.nodeId, index, '节点编号');
          liveNode(nodeId, index, '节点');
          claim(renamedNodes, nodeId, index, '同一个节点不要在一批里改两次');
          const title = optionalTitle(edit.title, index);
          const note = optionalNote(edit.note, index);
          if (title === undefined && note === undefined) bad(index, '要写标题或笔记');
          planned.push({
            op: 'rename_node',
            nodeId,
            ...(title !== undefined ? { title } : {}),
            ...(note !== undefined ? { note } : {}),
          });
          break;
        }
        case 'move_node': {
          const nodeId = requiredUuid(edit.nodeId, index, '节点编号');
          liveNode(nodeId, index, '节点');
          claim(movedNodes, nodeId, index, '同一个节点不要在一批里移动两次');
          const hasParentRef = edit.parentRef !== undefined && edit.parentRef.trim().length > 0;
          const hasParentId = edit.parentId !== undefined;
          if (hasParentRef === hasParentId) bad(index, '移动节点要写 parentId 或 parentRef 里的一个');
          if (hasParentRef) {
            const parentRef = requiredRef(edit.parentRef, index);
            if (refs.get(parentRef) !== 'node') bad(index, '父节点要指向本批更早新建的节点');
            planned.push({ op: 'move_node', nodeId, parentId: null, parentRef });
            break;
          }
          const parentId =
            edit.parentId === null ? null : requiredUuid(edit.parentId, index, '父节点编号');
          if (parentId) liveNode(parentId, index, '父节点');
          if (parentId === nodeId) bad(index, '节点不能挂到自己下面');
          planned.push({ op: 'move_node', nodeId, parentId });
          break;
        }
        case 'delete_node': {
          const nodeId = requiredUuid(edit.nodeId, index, '节点编号');
          liveNode(nodeId, index, '节点');
          claim(deletedNodes, nodeId, index, '同一个节点不要在一批里删两次');
          planned.push({ op: 'delete_node', nodeId });
          break;
        }
        case 'place_document':
        case 'place_card': {
          const hasNodeRef = edit.nodeRef !== undefined && edit.nodeRef.trim().length > 0;
          const hasNodeId = edit.nodeId !== undefined;
          if (hasNodeRef === hasNodeId) bad(index, '要写 nodeId 或 nodeRef 里的一个');
          let nodeId: string | null = null;
          let nodeRef: string | undefined;
          if (hasNodeRef) {
            nodeRef = requiredRef(edit.nodeRef, index);
            if (refs.get(nodeRef) !== 'node') bad(index, '节点要指向本批更早新建的节点');
          } else {
            nodeId = edit.nodeId === null ? null : requiredUuid(edit.nodeId, index, '节点编号');
            if (nodeId) liveNode(nodeId, index, '节点');
          }
          if (edit.op === 'place_document') {
            const documentId = requiredUuid(edit.documentId, index, '文档编号');
            claim(placedDocs, documentId, index, '同一篇文档不要在一批里改两次挂载');
            planned.push({
              op: 'place_document',
              documentId,
              nodeId,
              ...(nodeRef ? { nodeRef } : {}),
            });
            break;
          }
          const cardId = requiredUuid(edit.cardId, index, '卡片编号');
          claim(placedCards, cardId, index, '同一张卡片不要在一批里改两次挂载');
          planned.push({
            op: 'place_card',
            cardId,
            nodeId,
            ...(nodeRef ? { nodeRef } : {}),
          });
          break;
        }
        default: {
          const _never: never = edit.op;
          bad(index, `不认识这个操作 ${_never}`);
        }
      }
    }
    return { ok: true, edits: planned };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, reason: err.message };
    throw err;
  }
}
