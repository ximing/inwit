import { topicAdjustSummary } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { planTopicEdits, type TopicEditDraft } from './conversation-topic-logic.js';

const TOPIC = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const NODE = '33333333-3333-4333-8333-333333333333';
const CHILD = '44444444-4444-4444-8444-444444444444';

describe('planTopicEdits', () => {
  it('accepts a new topic, a chapter, and a child in one batch', () => {
    const plan = planTopicEdits([
      { op: 'create_topic', ref: 'algebra', title: ' 线性代数 ', goal: ' 看懂特征值 ' },
      { op: 'create_node', ref: 'ch1', topicRef: 'algebra', title: '矩阵' },
      { op: 'create_node', ref: 'ch2', topicRef: 'algebra', title: '特征值', parentRef: 'ch1' },
      { op: 'assign_document', documentId: DOC, topicRef: 'algebra' },
      { op: 'place_document', documentId: DOC, nodeRef: 'ch2' },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toEqual([
      { op: 'create_topic', ref: 'algebra', title: '线性代数', goal: '看懂特征值' },
      { op: 'create_node', ref: 'ch1', topicRef: 'algebra', title: '矩阵', parentId: null },
      {
        op: 'create_node',
        ref: 'ch2',
        topicRef: 'algebra',
        title: '特征值',
        parentId: null,
        parentRef: 'ch1',
      },
      { op: 'assign_document', documentId: DOC, topicId: null, topicRef: 'algebra' },
      { op: 'place_document', documentId: DOC, nodeId: null, nodeRef: 'ch2' },
    ]);
  });

  it('accepts unassign, root move, and taking a card off a node', () => {
    const plan = planTopicEdits([
      { op: 'assign_document', documentId: DOC, topicId: null },
      { op: 'move_node', nodeId: NODE, parentId: null },
      { op: 'place_card', cardId: CHILD, nodeId: null },
      { op: 'update_topic', topicId: TOPIC, goal: null },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits[0]).toEqual({ op: 'assign_document', documentId: DOC, topicId: null });
    expect(plan.edits[1]).toEqual({ op: 'move_node', nodeId: NODE, parentId: null });
    expect(plan.edits[3]).toEqual({ op: 'update_topic', topicId: TOPIC, goal: null });
  });

  it('rejects an empty batch, a bad id, and a parent that is a topic ref', () => {
    expect(planTopicEdits([]).ok).toBe(false);
    expect(planTopicEdits([{ op: 'update_topic', topicId: 'nope', title: '甲' }])).toEqual({
      ok: false,
      reason: '第 1 步：主题编号不合法',
    });
    const hung = planTopicEdits([
      { op: 'create_topic', ref: 'algebra', title: '线性代数' },
      { op: 'create_node', ref: 'ch1', topicRef: 'algebra', title: '矩阵', parentRef: 'algebra' },
    ]);
    expect(hung).toEqual({ ok: false, reason: '第 2 步：父节点要指向本批更早新建的节点' });
  });

  it('rejects duplicates, a deleted node, and an edit with nothing to change', () => {
    expect(
      planTopicEdits([
        { op: 'assign_document', documentId: DOC, topicId: TOPIC },
        { op: 'assign_document', documentId: DOC, topicId: null },
      ]),
    ).toEqual({ ok: false, reason: '第 2 步：同一篇文档不要在一批里改两次归属' });
    expect(
      planTopicEdits([
        { op: 'delete_node', nodeId: NODE },
        { op: 'rename_node', nodeId: NODE, title: '改名' },
      ]),
    ).toEqual({ ok: false, reason: '第 2 步：这个节点在这一批里已经删掉' });
    expect(planTopicEdits([{ op: 'update_topic', topicId: TOPIC }])).toEqual({
      ok: false,
      reason: '第 1 步：要写标题或目标',
    });
    expect(planTopicEdits([{ op: 'rename_node', nodeId: NODE, title: '   ' }])).toEqual({
      ok: false,
      reason: '第 1 步：标题不能为空',
    });
  });

  it('rejects both ids at once and an unknown operation', () => {
    expect(
      planTopicEdits([{ op: 'assign_document', documentId: DOC, topicId: TOPIC, topicRef: 'algebra' }]),
    ).toEqual({ ok: false, reason: '第 1 步：归属要写 topicId 或 topicRef 里的一个' });
    expect(planTopicEdits([{ op: 'archive_topic', topicId: TOPIC }])).toEqual({
      ok: false,
      reason: '第 1 步：不认识这个操作',
    });
    const tooMany: TopicEditDraft[] = Array.from({ length: 17 }, () => ({
      op: 'delete_node',
      nodeId: NODE,
    }));
    expect(planTopicEdits(tooMany).ok).toBe(false);
  });
});

describe('topicAdjustSummary', () => {
  it('names a new topic and a later map edit', () => {
    expect(
      topicAdjustSummary({
        title: '线性代数',
        status: 'applied',
        created: true,
        assignedCount: 2,
        createdNodeCount: 1,
      }),
    ).toBe('已新建主题「线性代数」：归入 2 篇，新建 1 个节点');
    expect(
      topicAdjustSummary({
        title: '线性代数',
        status: 'applied',
        titleChanged: true,
        unassignedCount: 1,
        deletedNodeCount: 1,
        clearedCardCount: 1,
      }),
    ).toBe('已调整主题「线性代数」：改了标题，移出 1 篇，删除 1 个节点，取下 1 张卡片');
    expect(
      topicAdjustSummary({
        title: '线性代数',
        status: 'rejected',
        reason: '第 2 步：主题已归档，无法写入',
      }),
    ).toBe('没能调整主题「线性代数」：第 2 步：主题已归档，无法写入');
  });
});
