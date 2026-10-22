import type { ConceptBatch, ConceptDetail, ConceptGraphPage, SyncChange } from '@inwit/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import {
  createConcept,
  createConceptBatch,
  getConcept,
  getConceptBatch,
  getConceptGraph,
  getDocumentKnowledge,
  listConcepts,
  postConceptGraphView,
  saveConceptBundle,
  setDocumentKnowledgeRef,
} from '@/api/concepts';
import type { DraftChoiceState } from './concept-selection-logic';
import { ConceptsService } from './concepts.service';

vi.mock('@/api/concepts', () => ({
  listConcepts: vi.fn(),
  getDocumentKnowledge: vi.fn(),
  getConceptGraph: vi.fn(),
  postConceptGraphView: vi.fn(),
  createConcept: vi.fn(),
  createConceptBatch: vi.fn(),
  getConcept: vi.fn(),
  getConceptRelation: vi.fn(),
  getConceptBatch: vi.fn(),
  saveConceptBundle: vi.fn(),
  setDocumentKnowledgeRef: vi.fn(),
}));

const T1 = '2026-10-16T00:00:00.000Z';
const emptyGraph: ConceptGraphPage = { nodes: [], nextCursor: null, graphRevision: 1 };

describe('ConceptsService select and detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConceptGraph).mockResolvedValue(emptyGraph);
    vi.mocked(postConceptGraphView).mockResolvedValue({ edges: [], nextEdgeCursor: null, graphRevision: 1 });
  });

  it('selects lightly without fetching detail', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    service.select({ kind: 'concept', id: 'node-a' });
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    expect(service.detail).toBeNull();
    expect(service.card).toBeNull();
    expect(getConcept).not.toHaveBeenCalled();
    service.dispose();
  });

  it('openDetail selects the target and fetches its detail', async () => {
    const detail = { marker: 'detail' } as unknown as ConceptDetail;
    vi.mocked(getConcept).mockResolvedValue(detail);
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    await service.openDetail({ kind: 'concept', id: 'node-a' });
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    expect(service.detail).toEqual(detail);
    expect(service.detailLoading).toBe(false);
    expect(getConcept).toHaveBeenCalledWith('node-a');
    service.dispose();
  });

  it('opens the info card only from openCard, and select closes it', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    service.openCard({ kind: 'concept', id: 'node-a' });
    expect(service.card).toEqual({ kind: 'concept', id: 'node-a' });
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    expect(getConcept).not.toHaveBeenCalled();
    service.closeCard();
    expect(service.card).toBeNull();
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    service.openCard({ kind: 'concept', id: 'node-a' });
    service.select({ kind: 'concept', id: 'node-b' });
    expect(service.card).toBeNull();
    service.dispose();
  });

  it('closeDetail closes the pane but keeps the selection', async () => {
    vi.mocked(getConcept).mockResolvedValue({ marker: 'detail' } as unknown as ConceptDetail);
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    await service.openDetail({ kind: 'concept', id: 'node-a' });
    service.closeDetail();
    expect(service.detail).toBeNull();
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    service.dispose();
  });

  it('clears the selection when the detail is gone', async () => {
    vi.mocked(getConcept).mockRejectedValue(new ApiError(404, 'NOT_FOUND', '概念不存在'));
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    await service.openDetail({ kind: 'concept', id: 'node-a' });
    expect(service.selected).toBeNull();
    expect(service.detail).toBeNull();
    expect(service.error).toBe('概念不存在');
    service.dispose();
  });
});

function batchOf(documentId: string, status: ConceptBatch['status'] = 'queued'): ConceptBatch {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    topicId: '33333333-3333-4333-8333-333333333333',
    documentId,
    status,
    scope: 'document',
    draftRevision: 1,
    draft: null,
    coverage: null,
    stale: false,
    errorCode: null,
    resultNote: null,
    commitResult: null,
    committedAt: null,
    retryOfBatchId: null,
    createdAt: T1,
    updatedAt: T1,
  };
}

function conceptChange(id = '1'): SyncChange {
  return { id, scope: 'concept', resourceId: null, op: 'upsert', at: T1 };
}

describe('ConceptsService flags and sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConceptGraph).mockResolvedValue(emptyGraph);
    vi.mocked(postConceptGraphView).mockResolvedValue({
      edges: [],
      nextEdgeCursor: null,
      graphRevision: 1,
    });
  });

  it('loads the graph without asking /health', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    expect(service.enabled).toBe(true);
    expect(service.writable).toBe(true);
    expect(getConceptGraph).toHaveBeenCalled();
    expect(listConcepts).not.toHaveBeenCalled();
    expect(getDocumentKnowledge).not.toHaveBeenCalled();
  });

  it('reloads the graph on a concept sync without touching view state', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    expect(getConceptGraph).toHaveBeenCalledTimes(1);

    const choiceState: DraftChoiceState = {
      concepts: { a: { kind: 'skip' } },
      relations: {},
      rebinds: {},
      acknowledged: {},
    };
    const detail = { marker: 'keep' } as unknown as ConceptDetail;
    const selected = { kind: 'concept' as const, id: 'sel-1' };
    service.viewport = { x: 4, y: 5, zoom: 1.4 };
    service.filter = 'inferred';
    service.query = '术语';
    service.choiceState = choiceState;
    service.detail = detail;
    service.selected = selected;
    service.positions = new Map([['n1', { x: 3, y: 4 }]]);
    service.highlightConceptIds = new Set(['h']);
    service.highlightRelationIds = new Set(['r']);
    const viewport = service.viewport;
    const positions = service.positions;
    const heldChoice = service.choiceState;
    const heldDetail = service.detail;
    const heldSelected = service.selected;
    const highlightConcepts = service.highlightConceptIds;
    const highlightRelations = service.highlightRelationIds;

    await service.handleSync({ type: 'changes', changes: [conceptChange()] });
    expect(getConceptGraph).toHaveBeenCalledTimes(2);
    expect(service.viewport).toBe(viewport);
    expect(service.viewport).toEqual({ x: 4, y: 5, zoom: 1.4 });
    expect(service.filter).toBe('inferred');
    expect(service.query).toBe('术语');
    expect(service.choiceState).toBe(heldChoice);
    expect(service.detail).toBe(heldDetail);
    expect(service.selected).toBe(heldSelected);
    expect(service.positions).toBe(positions);
    expect(service.positions.get('n1')).toEqual({ x: 3, y: 4 });
    expect(service.highlightConceptIds).toBe(highlightConcepts);
    expect(service.highlightRelationIds).toBe(highlightRelations);
  });

  it('ignores a document-scoped sync', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    await service.handleSync({
      type: 'changes',
      changes: [
        {
          id: '2',
          scope: 'document',
          resourceId: '11111111-1111-4111-8111-111111111111',
          op: 'upsert',
          at: T1,
        },
      ],
    });
    expect(getConceptGraph).toHaveBeenCalledTimes(1);
  });

  it('cites a concept created in the open document', async () => {
    const conceptId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(createConcept).mockResolvedValue({
      concept: {
        id: conceptId,
        userId: '22222222-2222-4222-8222-222222222222',
        topicId: '33333333-3333-4333-8333-333333333333',
        name: 'Task',
        aliases: [],
        sense: null,
        definition: null,
        example: null,
        origin: 'manual',
        version: 1,
        archivedAt: null,
        createdAt: T1,
        updatedAt: T1,
      },
      matches: [],
    });
    vi.mocked(setDocumentKnowledgeRef).mockResolvedValue({ refId: 'ref-1' });
    const service = new ConceptsService();
    await service.boot('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
    await service.createConcept({ name: 'Task', aliases: [], evidence: [] });
    expect(setDocumentKnowledgeRef).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      expect.objectContaining({
        topicId: '33333333-3333-4333-8333-333333333333',
        targetKind: 'concept',
        targetId: conceptId,
      }),
    );
    expect(getConceptGraph).toHaveBeenCalledTimes(2);
  });

  it('does not cite a concept created from the topic page', async () => {
    vi.mocked(createConcept).mockResolvedValue({
      concept: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        topicId: 'topic-1',
        name: 'Task',
        aliases: [],
        sense: null,
        definition: null,
        example: null,
        origin: 'manual',
        version: 1,
        archivedAt: null,
        createdAt: T1,
        updatedAt: T1,
      },
      matches: [],
    });
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    await service.createConcept({ name: 'Task', aliases: [], evidence: [] });
    expect(setDocumentKnowledgeRef).not.toHaveBeenCalled();
  });

  it('sends the open document when saving a relation bundle', async () => {
    vi.mocked(saveConceptBundle).mockResolvedValue({
      concept: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        topicId: '33333333-3333-4333-8333-333333333333',
        name: 'Task',
        aliases: [],
        sense: null,
        definition: null,
        example: null,
        origin: 'manual',
        version: 1,
        archivedAt: null,
        createdAt: T1,
        updatedAt: T1,
      },
      conceptReused: true,
      createdConcepts: [],
      relations: [],
    });
    const service = new ConceptsService();
    const documentId = '44444444-4444-4444-8444-444444444444';
    await service.boot('33333333-3333-4333-8333-333333333333', documentId);
    await service.saveBundle({
      concept: {
        kind: 'reuse',
        conceptId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 1,
        evidence: [],
      },
      relations: [
        {
          direction: 'outgoing',
          other: { kind: 'existing', conceptId: '55555555-5555-4555-8555-555555555555' },
          kind: 'composition',
          predicate: '包含',
          basis: 'user',
          evidence: [],
        },
      ],
    });
    expect(saveConceptBundle).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ documentId }),
    );
  });

  it('hides a concept batch when another document is open and restores it on return', async () => {
    const service = new ConceptsService();
    const docA = '44444444-4444-4444-8444-444444444444';
    const docB = '55555555-5555-4555-8555-555555555555';
    await service.boot('topic-1', docA);
    service.batch = batchOf(docA, 'ready');
    service.batchPhase = 'ready';
    service.choiceState = { concepts: { a: { kind: 'skip' } }, relations: {}, rebinds: {}, acknowledged: {} };

    await service.boot('topic-1', docB);
    expect(service.documentId).toBe(docB);
    expect(service.batch).toBeNull();
    expect(service.batchPhase).toBe('idle');
    expect(service.choiceState).toBeNull();

    await service.boot('topic-1', docA);
    expect(service.batch?.documentId).toBe(docA);
    expect(service.batchPhase).toBe('ready');
    expect(service.choiceState?.concepts.a).toEqual({ kind: 'skip' });
    expect(getConceptBatch).not.toHaveBeenCalled();
    service.dispose();
  });

  it('keeps an in-flight generation on the document that started it', async () => {
    const docA = '44444444-4444-4444-8444-444444444444';
    const docB = '55555555-5555-4555-8555-555555555555';
    const batch = batchOf(docA, 'running');
    let resolveCreate: (value: { batchId: string; jobId: string }) => void = () => {};
    vi.mocked(createConceptBatch).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    vi.mocked(getConceptBatch).mockResolvedValue(batch);

    const service = new ConceptsService();
    await service.boot('topic-1', docA);
    const pending = service.startGeneration('document');
    await Promise.resolve();
    expect(service.batchPhase).toBe('generating');

    await service.boot('topic-1', docB);
    expect(service.batch).toBeNull();
    expect(service.batchPhase).toBe('idle');

    resolveCreate({ batchId: batch.id, jobId: '66666666-6666-4666-8666-666666666666' });
    await pending;
    expect(service.documentId).toBe(docB);
    expect(service.batch).toBeNull();
    expect(getConceptBatch).not.toHaveBeenCalled();

    await service.boot('topic-1', docA);
    expect(service.batch?.id).toBe(batch.id);
    expect(service.batch?.documentId).toBe(docA);
    expect(service.batchPhase).toBe('generating');
    expect(getConceptBatch).toHaveBeenCalledWith(batch.id);
    service.dispose();
  });

  it('expand centers the next level and back restores the previous viewport', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    service.viewport = { x: 10, y: 20, zoom: 1.2 };
    service.positions = new Map([['kept', { x: 4, y: 5 }]]);
    service.openCard({ kind: 'concept', id: 'node-a' });
    vi.mocked(getConceptGraph).mockResolvedValue({
      nodes: [
        {
          concept: { id: 'node-a', name: '甲' } as ConceptGraphPage['nodes'][number]['concept'],
          membership: 'direct',
        },
      ],
      nextCursor: null,
      graphRevision: 2,
    });
    vi.mocked(getConcept).mockResolvedValue({ marker: 'detail' } as unknown as ConceptDetail);
    await service.expandNeighbors('node-a');
    expect(service.focusId).toBe('node-a');
    expect(service.focusStack).toEqual([
      {
        focusId: null,
        label: '全文',
        viewport: { x: 10, y: 20, zoom: 1.2 },
        positions: new Map([['kept', { x: 4, y: 5 }]]),
      },
    ]);
    expect(service.positions.size).toBe(0);
    expect(service.card).toBeNull();
    expect(service.centerRequest?.id).toBe('node-a');
    expect(service.selected).toEqual({ kind: 'concept', id: 'node-a' });
    expect(service.focusCrumbs.map((crumb) => crumb.label)).toEqual(['全文', '甲']);

    service.viewport = { x: 80, y: 90, zoom: 1.4 };
    await service.expandNeighbors('node-a');
    expect(service.focusStack).toHaveLength(1);

    vi.mocked(getConceptGraph).mockResolvedValue(emptyGraph);
    await service.backFocus();
    expect(service.focusId).toBeNull();
    expect(service.focusStack).toEqual([]);
    expect(service.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 });
    expect(service.positions.get('kept')).toEqual({ x: 4, y: 5 });
    expect(service.centerRequest).toBeNull();
    service.dispose();
  });

  it('jumpFocus returns to an earlier level and restores that viewport', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    service.viewport = { x: 10, y: 20, zoom: 1.2 };
    vi.mocked(getConcept).mockResolvedValue({ marker: 'detail' } as unknown as ConceptDetail);
    vi.mocked(getConceptGraph).mockResolvedValue({
      nodes: [
        {
          concept: { id: 'node-a', name: '甲' } as ConceptGraphPage['nodes'][number]['concept'],
          membership: 'direct',
        },
      ],
      nextCursor: null,
      graphRevision: 2,
    });
    await service.expandNeighbors('node-a');
    service.viewport = { x: 30, y: 40, zoom: 1 };
    vi.mocked(getConceptGraph).mockResolvedValue({
      nodes: [
        {
          concept: { id: 'node-b', name: '乙' } as ConceptGraphPage['nodes'][number]['concept'],
          membership: 'direct',
        },
      ],
      nextCursor: null,
      graphRevision: 3,
    });
    await service.expandNeighbors('node-b');
    expect(service.focusCrumbs.map((crumb) => crumb.label)).toEqual(['全文', '甲', '乙']);
    vi.mocked(getConceptGraph).mockResolvedValue(emptyGraph);
    await service.jumpFocus(0);
    expect(service.focusId).toBeNull();
    expect(service.focusStack).toEqual([]);
    expect(service.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 });
    expect(service.centerRequest).toBeNull();
  });

  it('keeps the camera when the same document boots again', async () => {
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    service.viewport = { x: 4, y: 5, zoom: 1.4 };
    service.positions = new Map([['n1', { x: 3, y: 4 }]]);
    service.viewMode = 'list';
    service.query = '术语';
    const viewport = service.viewport;
    const positions = service.positions;

    await service.boot('topic-1', 'doc-1');
    expect(service.viewport).toBe(viewport);
    expect(service.positions).toBe(positions);
    expect(service.viewMode).toBe('list');
    expect(service.query).toBe('术语');
    expect(listConcepts).not.toHaveBeenCalled();
  });

  it('restores concept view state with the document that owned it', async () => {
    vi.mocked(getConcept).mockResolvedValue({ marker: 'detail' } as unknown as ConceptDetail);
    vi.mocked(listConcepts).mockResolvedValue({ items: [], nextCursor: null });
    const service = new ConceptsService();
    const docA = '44444444-4444-4444-8444-444444444444';
    const docB = '55555555-5555-4555-8555-555555555555';
    await service.boot('topic-1', docA);
    service.viewport = { x: 2, y: 3, zoom: 1.2 };
    service.positions = new Map([['n1', { x: 8, y: 9 }]]);
    const viewport = service.viewport;
    const positions = service.positions;
    service.viewMode = 'list';
    service.query = '背包';
    service.filter = 'document';
    service.focusId = '11111111-1111-4111-8111-111111111111';
    service.selected = { kind: 'concept', id: '11111111-1111-4111-8111-111111111111' };
    service.createPrefill = '子序列';
    service.editor = 'concept';
    service.conceptForm = { name: '子序列', sense: '语境', definition: '定义', aliases: '' };
    service.linkDraft = { fromId: 'a', toId: 'b' };
    service.linkForm = { predicate: '包含', kind: 'composition' };
    service.highlightConceptIds = new Set(['h']);

    await service.boot('topic-1', docB);
    expect(service.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(service.viewport).not.toBe(viewport);
    expect(service.positions).not.toBe(positions);
    expect(service.positions.size).toBe(0);
    expect(service.viewMode).toBe('graph');
    expect(service.query).toBe('');
    expect(service.filter).toBe('all');
    expect(service.selected).toBeNull();
    expect(service.focusId).toBeNull();
    expect(service.createPrefill).toBeNull();
    expect(service.editor).toBeNull();
    expect(service.conceptForm).toBeNull();
    expect(service.linkDraft).toBeNull();
    expect(service.highlightConceptIds.size).toBe(0);
    positions.set('n2', { x: 1, y: 1 });

    await service.boot('topic-1', docA);
    expect(service.viewport).toEqual({ x: 2, y: 3, zoom: 1.2 });
    expect(service.positions).toBe(positions);
    expect(service.positions.get('n2')).toEqual({ x: 1, y: 1 });
    expect(service.viewMode).toBe('list');
    expect(service.query).toBe('背包');
    expect(service.filter).toBe('document');
    expect(service.focusId).toBe('11111111-1111-4111-8111-111111111111');
    expect(service.createPrefill).toBe('子序列');
    expect(service.editor).toBe('concept');
    expect(service.conceptForm).toEqual({ name: '子序列', sense: '语境', definition: '定义', aliases: '' });
    expect(service.linkDraft).toEqual({ fromId: 'a', toId: 'b' });
    expect(service.linkForm).toEqual({ predicate: '包含', kind: 'composition' });
    expect(service.selected).toEqual({ kind: 'concept', id: '11111111-1111-4111-8111-111111111111' });
    expect(service.highlightConceptIds.size).toBe(0);
    // 选中恢复后不再回拉详情：信息卡已够用，详情由用户显式打开。
    expect(getConcept).not.toHaveBeenCalled();
    expect(listConcepts).toHaveBeenCalledWith('topic-1', expect.objectContaining({ q: '背包' }));
    expect(getConceptGraph).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ focusId: '11111111-1111-4111-8111-111111111111' }),
    );
    service.dispose();
  });
});
