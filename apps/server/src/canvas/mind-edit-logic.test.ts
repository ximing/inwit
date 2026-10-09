import { describe, expect, it } from 'vitest';
import { formatDocumentMind, planMindEdits, type MindEditMember } from './mind-edit-logic.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const CHAPTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function member(
  id: string,
  kind: MindEditMember['kind'],
  parentId: string | null,
  position = 0,
): MindEditMember {
  return { id, kind, parentId, position };
}

function parentOf(nodes: readonly MindEditMember[], id: string): string | null | undefined {
  return nodes.find((node) => node.id === id)?.parentId;
}

describe('planMindEdits', () => {
  it('builds chapters and hangs an unplaced card under a new section', () => {
    const plan = planMindEdits(
      [member(CARD, 'card', null, 0), member(NOTE, 'annotation', null, 1)],
      [
        { op: 'create_text', ref: 'c1', text: ' 第一章 ' },
        { op: 'create_text', ref: 's1', text: '背景', parentRef: 'c1' },
        { op: 'move', nodeId: CARD, parentRef: 's1' },
      ],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.createdCount).toBe(2);
    expect(plan.movedCount).toBe(1);
    expect(parentOf(plan.nodes, 'ref:c1')).toBeNull();
    expect(parentOf(plan.nodes, 'ref:s1')).toBe('ref:c1');
    expect(parentOf(plan.nodes, CARD)).toBe('ref:s1');
    expect(parentOf(plan.nodes, NOTE)).toBeNull();
  });

  it('leaves nodes that the batch does not name', () => {
    const plan = planMindEdits(
      [member(CHAPTER, 'text', null, 0), member(CARD, 'card', CHAPTER, 0), member(NOTE, 'annotation', null, 1)],
      [{ op: 'rename_text', nodeId: CHAPTER, text: '新标题' }],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(parentOf(plan.nodes, CARD)).toBe(CHAPTER);
    expect(parentOf(plan.nodes, NOTE)).toBeNull();
    expect(plan.renamedCount).toBe(1);
  });

  it('appends a root chapter after the existing roots', () => {
    const plan = planMindEdits(
      [member(CHAPTER, 'text', null, 0), member(CARD, 'card', null, 2)],
      [{ op: 'create_text', ref: 'c2', text: '第二章' }],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nodes.find((node) => node.id === 'ref:c2')).toMatchObject({
      parentId: null,
      position: 3,
    });
    expect(plan.nodes.find((node) => node.id === CHAPTER)?.position).toBe(0);
    expect(plan.nodes.find((node) => node.id === CARD)?.position).toBe(2);
  });

  it('can reparent a card that already has a parent', () => {
    const plan = planMindEdits(
      [member(CHAPTER, 'text', null), member(SECTION, 'text', null, 1), member(CARD, 'card', CHAPTER)],
      [{ op: 'move', nodeId: CARD, parentId: SECTION }],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(parentOf(plan.nodes, CARD)).toBe(SECTION);
  });

  it('detaches children when a chapter is deleted and keeps the grandchild', () => {
    const plan = planMindEdits(
      [
        member(CHAPTER, 'text', null),
        member(SECTION, 'text', CHAPTER),
        member(CARD, 'card', SECTION),
      ],
      [{ op: 'delete_text', nodeId: CHAPTER }],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nodes.some((node) => node.id === CHAPTER)).toBe(false);
    expect(parentOf(plan.nodes, SECTION)).toBeNull();
    expect(parentOf(plan.nodes, CARD)).toBe(SECTION);
  });

  it('refuses a cycle, a ninth level, a missing ref, and deleting a card', () => {
    expect(
      planMindEdits(
        [member(CHAPTER, 'text', null), member(SECTION, 'text', CHAPTER)],
        [{ op: 'move', nodeId: CHAPTER, parentId: SECTION }],
      ),
    ).toEqual({ ok: false, reason: '这样放会形成环' });

    const chain: MindEditMember[] = [member(CHAPTER, 'text', null)];
    let parent = CHAPTER;
    const ids = [
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000006',
      '10000000-0000-4000-8000-000000000007',
      '10000000-0000-4000-8000-000000000008',
    ];
    for (const id of ids) {
      chain.push(member(id, 'text', parent));
      parent = id;
    }
    expect(
      planMindEdits(chain, [{ op: 'create_text', ref: 'deep', text: '太深', parentId: parent }]).ok,
    ).toBe(false);

    expect(
      planMindEdits([], [{ op: 'create_text', ref: 's1', text: '节', parentRef: 'c1' }]),
    ).toEqual({ ok: false, reason: '还没有名为 c1 的章节' });

    expect(planMindEdits([member(CARD, 'card', null)], [{ op: 'delete_text', nodeId: CARD }])).toEqual({
      ok: false,
      reason: '只能删除章节文本',
    });
    expect(
      planMindEdits([member(CARD, 'card', null)], [{ op: 'rename_text', nodeId: CARD, text: '改名' }]),
    ).toEqual({ ok: false, reason: '只能修改章节标题' });
  });

  it('refuses two parents, a move without a parent, and an empty batch', () => {
    expect(
      planMindEdits([], [
        { op: 'create_text', ref: 'c1', text: '章', parentId: null, parentRef: 'c0' },
      ]),
    ).toEqual({ ok: false, reason: '父节点只能指定一个' });
    expect(planMindEdits([member(CARD, 'card', null)], [{ op: 'move', nodeId: CARD }])).toEqual({
      ok: false,
      reason: '移动时要写明父节点，挂到最外层请把 parentId 设为 null',
    });
    expect(planMindEdits([], [])).toEqual({ ok: false, reason: '这次没有修改' });
    expect(
      planMindEdits([], [{ op: 'create_text', ref: 'c1', text: '章' }, { op: 'create_text', ref: 'c1', text: '又' }]),
    ).toEqual({ ok: false, reason: '章节编号重复：c1' });
    expect(planMindEdits([], [{ op: 'move', nodeId: OTHER, parentId: null }])).toEqual({
      ok: false,
      reason: '找不到这个节点',
    });
  });
});

describe('formatDocumentMind', () => {
  it('indents children and keeps ids', () => {
    const text = formatDocumentMind({
      documentId: DOC,
      title: '梯度',
      nodes: [
        { ...member(CHAPTER, 'text', null), label: '第一章' },
        { ...member(CARD, 'card', CHAPTER), label: '梯度是方向' },
        { ...member(NOTE, 'annotation', null, 1), label: '页边一句' },
      ],
    }).text;
    expect(text).toContain(`《梯度》（${DOC}）`);
    expect(text).toContain(`文本 第一章 id=${CHAPTER} parent=-`);
    expect(text).toContain(`  卡片 梯度是方向 id=${CARD} parent=${CHAPTER}`);
    expect(text).toContain(`批注 页边一句 id=${NOTE} parent=-`);
  });

  it('says the map is empty, and clips a long list', () => {
    expect(formatDocumentMind({ documentId: DOC, title: '空', nodes: [] }).text).toContain('脑图是空的');
    const nodes = Array.from({ length: 20 }, (_, index) => ({
      ...member(`10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, 'card', null, index),
      label: '卡',
    }));
    const view = formatDocumentMind({ documentId: DOC, title: '多', nodes, maxChars: 180 });
    expect(view.truncated).toBe(true);
    expect(view.text).toContain('没有列出');
  });
});
