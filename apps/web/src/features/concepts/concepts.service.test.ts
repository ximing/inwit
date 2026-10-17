import type { ConceptDetail, ConceptGraphPage, SyncChange } from '@inwit/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import {
  createConcept,
  createConceptBatch,
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
  saveConceptBundle: vi.fn(),
  setDocumentKnowledgeRef: vi.fn(),
}));

const T1 = '2026-10-16T00:00:00.000Z';
const emptyGraph: ConceptGraphPage = { nodes: [], nextCursor: null, graphRevision: 1 };

function conceptChange(id = '1'): SyncChange {
  return { id, scope: 'concept', resourceId: null, op: 'upsert', at: T1 };
}

function stubHealth(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

describe('ConceptsService flags and sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getConceptGraph).mockResolvedValue(emptyGraph);
    vi.mocked(postConceptGraphView).mockResolvedValue({
      edges: [],
      nextEdgeCursor: null,
      graphRevision: 1,
    });
  });

  it('stays hidden when health disables concepts', async () => {
    stubHealth({ ok: true, conceptsEnabled: false, conceptsWritable: false });
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    expect(service.enabled).toBe(false);
    expect(service.writable).toBe(false);
    expect(service.probed).toBe(true);
    expect(listConcepts).not.toHaveBeenCalled();
    expect(getDocumentKnowledge).not.toHaveBeenCalled();
    expect(getConceptGraph).not.toHaveBeenCalled();
  });

  it('loads the graph and refuses writes when health is read-only', async () => {
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: false });
    const service = new ConceptsService();
    await service.boot('topic-1', 'doc-1');
    expect(service.enabled).toBe(true);
    expect(service.writable).toBe(false);
    expect(service.probed).toBe(true);
    expect(getConceptGraph).toHaveBeenCalled();
    await expect(service.createConcept({ name: '甲', aliases: [], evidence: [] })).rejects.toThrow(
      '概念功能当前只读',
    );
    expect(createConcept).not.toHaveBeenCalled();
    await service.startGeneration('document');
    expect(createConceptBatch).not.toHaveBeenCalled();
    expect(service.error).toBe('概念功能当前只读');
  });

  it('hides concepts when health fails and the read API is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('health down');
      }),
    );
    vi.mocked(listConcepts).mockRejectedValue(new ApiError(404, 'CONCEPTS_DISABLED', '概念功能尚未开放'));
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    expect(service.enabled).toBe(false);
    expect(service.writable).toBe(false);
    expect(service.probed).toBe(true);
    expect(listConcepts).toHaveBeenCalled();
    expect(getConceptGraph).not.toHaveBeenCalled();
  });

  it('treats a successful read probe as enabled and writable when health fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    vi.mocked(listConcepts).mockResolvedValue({ items: [], nextCursor: null });
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    expect(service.enabled).toBe(true);
    expect(service.writable).toBe(true);
    expect(service.probed).toBe(true);
    expect(listConcepts).toHaveBeenCalled();
    expect(getConceptGraph).toHaveBeenCalled();
  });

  it('reloads the graph on a concept sync without touching view state', async () => {
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: true });
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
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: true });
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

  it('does not reload the graph for a concept sync while disabled', async () => {
    stubHealth({ ok: true, conceptsEnabled: false, conceptsWritable: false });
    const service = new ConceptsService();
    await service.boot('topic-1', null);
    await service.handleSync({ type: 'changes', changes: [conceptChange()] });
    await service.handleSync({ type: 'reset' });
    expect(getConceptGraph).not.toHaveBeenCalled();
  });

  it('cites a concept created in the open document', async () => {
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: true });
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
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: true });
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
    stubHealth({ ok: true, conceptsEnabled: true, conceptsWritable: true });
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
});
