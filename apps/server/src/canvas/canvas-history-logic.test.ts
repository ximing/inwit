import { describe, expect, it } from 'vitest';
import type { CanvasSnapshotNode } from '@inwit/dto';
import { canvasSnapshotSchema } from '@inwit/dto';
import {
  CANVAS_HISTORY_BASELINE,
  canvasRevisionMatches,
  cardOutlinesAfterRestore,
  describeCanvasChange,
  describeHistoryChange,
  normalizeCanvasSnapshot,
  planAnnotationRestore,
  planCanvasRestore,
  restoreCanvasSummary,
} from './canvas-history-logic.js';

const CARD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TEXT = '33333333-3333-4333-8333-333333333333';
const IMAGE = '44444444-4444-4444-8444-444444444444';
const NOTE = '55555555-5555-4555-8555-555555555555';

function node(partial: Pick<CanvasSnapshotNode, 'id' | 'kind'> & Partial<CanvasSnapshotNode>): CanvasSnapshotNode {
  return {
    cardId: partial.kind === 'card' ? partial.id : null,
    annotationId: partial.kind === 'annotation' ? partial.id : null,
    text: partial.kind === 'text' ? '章节' : null,
    imageKey: partial.kind === 'image' ? 'users/u/doc-assets/a.png' : null,
    parentId: null,
    position: 0,
    ...partial,
  };
}

const live = {
  cardIds: new Set([CARD, OTHER]),
  annotationIds: new Set([NOTE]),
};

describe('describeCanvasChange', () => {
  it('returns null when nothing changed', () => {
    const row = node({ id: TEXT, kind: 'text' });
    expect(describeCanvasChange([row], [{ ...row }])).toBeNull();
  });

  it('describes chapters, titles, moves, and deletions', () => {
    const before = [
      node({ id: CARD, kind: 'card', position: 0 }),
      node({ id: TEXT, kind: 'text', text: '旧标题', position: 1 }),
      node({ id: IMAGE, kind: 'image', position: 2 }),
    ];
    const after = [
      node({ id: CARD, kind: 'card', parentId: TEXT, position: 0 }),
      node({ id: TEXT, kind: 'text', text: '新标题', position: 1 }),
      node({ id: OTHER, kind: 'card', position: 1 }),
      node({ id: '66666666-6666-4666-8666-666666666666', kind: 'text', text: '第二章', position: 2 }),
    ];
    expect(describeCanvasChange(before, after)).toBe(
      '新建 1 个章节，改了 1 个章节标题，移动 2 个节点，去掉 1 张图片',
    );
  });

  it('counts a removed card row as a move back to the root', () => {
    expect(
      describeCanvasChange(
        [node({ id: CARD, kind: 'card', parentId: TEXT, position: 0 })],
        [],
      ),
    ).toBe('移动 1 个节点');
  });
});

describe('planCanvasRestore', () => {
  it('reinserts a deleted chapter and drops a chapter created later', () => {
    const current = [
      node({ id: CARD, kind: 'card', position: 1 }),
      node({ id: OTHER, kind: 'text', text: '后来的章', position: 0 }),
    ];
    const target = [
      node({ id: TEXT, kind: 'text', text: '第一章', position: 0 }),
      node({ id: CARD, kind: 'card', parentId: TEXT, position: 0 }),
    ];
    const plan = planCanvasRestore(current, target, live);
    expect(plan.deleteIds).toEqual([OTHER]);
    expect(plan.insert).toEqual([node({ id: TEXT, kind: 'text', text: '第一章', position: 0 })]);
    expect(plan.update).toEqual([
      node({ id: CARD, kind: 'card', parentId: TEXT, position: 0 }),
    ]);
  });

  it('does not recreate a card that is gone, and detaches its children', () => {
    const gone = '77777777-7777-4777-8777-777777777777';
    const plan = planCanvasRestore(
      [],
      [
        node({ id: gone, kind: 'card' }),
        node({ id: TEXT, kind: 'text', text: '章', parentId: gone, position: 0 }),
      ],
      live,
    );
    expect(plan.final.map((item) => item.id)).toEqual([TEXT]);
    expect(plan.final[0]?.parentId).toBeNull();
    expect(plan.insert).toEqual([node({ id: TEXT, kind: 'text', text: '章', position: 0 })]);
  });

  it('refuses to parent a node under itself', () => {
    const plan = planCanvasRestore(
      [],
      [node({ id: TEXT, kind: 'text', text: '章', parentId: TEXT })],
      live,
    );
    expect(plan.final[0]?.parentId).toBeNull();
  });

  it('leaves an unchanged tree with nothing to write', () => {
    const rows = [node({ id: TEXT, kind: 'text', text: '章', position: 1 })];
    const plan = planCanvasRestore(rows, rows, live);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
  });
});

describe('cardOutlinesAfterRestore', () => {
  it('mirrors a card parent and clears a card that left the snapshot', () => {
    expect(
      cardOutlinesAfterRestore(
        [node({ id: CARD, kind: 'card', parentId: OTHER, position: 2 })],
        [
          node({ id: OTHER, kind: 'card', position: 0 }),
          node({ id: TEXT, kind: 'text', text: '章', position: 1 }),
        ],
      ),
    ).toEqual([
      { id: OTHER, parentId: null, position: 0 },
      { id: CARD, parentId: null, position: 0 },
    ]);
  });

  it('keeps the outline parent only when the canvas parent is a card', () => {
    expect(
      cardOutlinesAfterRestore(
        [],
        [
          node({ id: TEXT, kind: 'text', text: '章', position: 0 }),
          node({ id: CARD, kind: 'card', parentId: TEXT, position: 3 }),
        ],
      ),
    ).toEqual([{ id: CARD, parentId: null, position: 3 }]);
  });
});

describe('describeHistoryChange', () => {
  const note = { id: NOTE, note: '想法', imageKey: null as string | null };

  it('keeps the canvas summary when annotations do not change', () => {
    const before = [node({ id: CARD, kind: 'card', parentId: TEXT, position: 0 })];
    expect(
      describeHistoryChange(
        { nodes: before, annotations: [note] },
        { nodes: [], annotations: [note] },
      ),
    ).toBe('移动 1 个节点');
  });

  it('counts a new note and its new row once', () => {
    expect(
      describeHistoryChange(
        { nodes: [], annotations: [] },
        {
          nodes: [node({ id: NOTE, kind: 'annotation' })],
          annotations: [note],
        },
      ),
    ).toBe('移动 1 个节点');
  });

  it('counts a note that appears without a canvas row', () => {
    expect(
      describeHistoryChange(
        { nodes: [], annotations: [] },
        { nodes: [], annotations: [note] },
      ),
    ).toBe('移动 1 个节点');
  });

  it('describes a note edit on its own', () => {
    const nodes = [node({ id: NOTE, kind: 'annotation' })];
    expect(
      describeHistoryChange(
        { nodes, annotations: [note] },
        { nodes, annotations: [{ ...note, note: '改过的想法' }] },
      ),
    ).toBe('改了 1 条批注');
  });

  it('describes a quote retarget as an annotation edit', () => {
    const nodes = [node({ id: NOTE, kind: 'annotation' })];
    const before = {
      id: NOTE,
      note: '§5',
      imageKey: null as string | null,
      quote: '路线图',
      anchorBlockIndex: 2,
    };
    expect(
      describeHistoryChange(
        { nodes, annotations: [before] },
        { nodes, annotations: [{ ...before, quote: '5 Scheduling', anchorBlockIndex: 8 }] },
      ),
    ).toBe('改了 1 条批注');
  });
});

describe('planAnnotationRestore', () => {
  it('archives notes that the target version did not have', () => {
    expect(planAnnotationRestore([NOTE, OTHER], [{ id: NOTE }])).toEqual([OTHER]);
  });

  it('leaves notes alone when the snapshot did not record them', () => {
    expect(planAnnotationRestore([NOTE], null)).toEqual([]);
  });
});

describe('canvasRevisionMatches', () => {
  const nodes = [node({ id: NOTE, kind: 'annotation' })];
  const live = {
    nodes,
    annotations: [
      { id: NOTE, note: '想法', imageKey: null },
      { id: OTHER, note: '后来的高亮', imageKey: null },
    ],
  };

  it('ignores annotations that appeared after a legacy snapshot', () => {
    expect(canvasRevisionMatches({ nodes, annotations: null }, live)).toBe(true);
  });

  it('stays current when an extra note is not part of the snapshot', () => {
    expect(
      canvasRevisionMatches(
        { nodes, annotations: [{ id: NOTE, note: '想法', imageKey: null }] },
        live,
      ),
    ).toBe(true);
  });

  it('is not current after a snapshotted note changes', () => {
    expect(
      canvasRevisionMatches(
        { nodes, annotations: [{ id: NOTE, note: '旧想法', imageKey: null }] },
        live,
      ),
    ).toBe(false);
  });

  it('ignores a quote the snapshot did not record', () => {
    expect(
      canvasRevisionMatches(
        { nodes, annotations: [{ id: NOTE, note: '想法', imageKey: null }] },
        {
          nodes,
          annotations: [
            { id: NOTE, note: '想法', imageKey: null, quote: '新引文', anchorBlockIndex: 4 },
            { id: OTHER, note: '后来的高亮', imageKey: null },
          ],
        },
      ),
    ).toBe(true);
  });

  it('is not current when the stored quote differs', () => {
    expect(
      canvasRevisionMatches(
        {
          nodes,
          annotations: [{ id: NOTE, note: '想法', imageKey: null, quote: '旧引文', anchorBlockIndex: 1 }],
        },
        {
          nodes,
          annotations: [{ id: NOTE, note: '想法', imageKey: null, quote: '新引文', anchorBlockIndex: 1 }],
        },
      ),
    ).toBe(false);
  });
});

describe('canvasSnapshotSchema', () => {
  it('accepts a legacy node array and a document snapshot', () => {
    const row = node({ id: TEXT, kind: 'text' });
    expect(normalizeCanvasSnapshot(canvasSnapshotSchema.parse([row]))).toEqual({
      nodes: [row],
      annotations: null,
    });
    const document = {
      nodes: [row],
      annotations: [{ id: NOTE, note: '想法', imageKey: null }],
    };
    expect(normalizeCanvasSnapshot(canvasSnapshotSchema.parse(document))).toEqual(document);
    const anchored = {
      nodes: [row],
      annotations: [{ id: NOTE, note: '§5', imageKey: null, quote: '5 Scheduling', anchorBlockIndex: 8 }],
    };
    expect(normalizeCanvasSnapshot(canvasSnapshotSchema.parse(anchored))).toEqual(anchored);
  });
});

describe('restoreCanvasSummary', () => {
  it('names the baseline and a dated version', () => {
    expect(restoreCanvasSummary(CANVAS_HISTORY_BASELINE, new Date('2026-10-09T06:21:00Z'))).toBe(
      '恢复到开始记录之前',
    );
    const dated = restoreCanvasSummary('新建 1 个章节', new Date('2026-10-09T06:21:00Z'));
    expect(dated.startsWith('恢复到 ')).toBe(true);
    expect(dated.endsWith(' 的脑图')).toBe(true);
  });
});
