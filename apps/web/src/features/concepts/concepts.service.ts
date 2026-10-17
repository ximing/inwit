import { Service } from '@rabjs/react';
import { SyncService, type SyncEvent } from '@/services/sync.service';
import type {
  BindExistingConceptPracticeInput,
  CommitConceptBatchInput,
  Concept,
  ConceptBatch,
  ConceptDetail,
  ConceptDraft,
  ConceptMatch,
  ConceptRelation,
  ConceptRelationDetail,
  CreateConceptInput,
  CreateConceptPracticeInput,
  CreateConceptPracticeProposalInput,
  CreateConceptResult,
  DocumentKnowledge,
  RefreshConceptPracticeInput,
  ResumeConceptPracticeInput,
  SaveConceptBundleInput,
  UpdateConceptInput,
  UpdateConceptRelationInput,
} from '@inwit/dto';
import { ApiError } from '@/api/client';
import * as api from '@/api/concepts';
import {
  buildCommitPlan,
  chooseConcept,
  chooseRelation,
  defaultChoiceState,
  rebindRelation,
  type DraftChoiceState,
} from './concept-selection-logic.js';

export type ConceptViewMode = 'graph' | 'list';
export type ConceptFilter = 'all' | 'document' | 'inferred' | 'practice';
export type ConceptTarget = { kind: 'concept' | 'relation'; id: string };

const READONLY_ERROR = '概念功能当前只读';

/** 概念域 Service：文章（documentId+topicId）或主题（topicId）一个实例。 */
export class ConceptsService extends Service {
  topicId: string | null = null;
  documentId: string | null = null;
  /** 概念入口始终可见。 */
  enabled = true;
  /** 概念写入始终开放。 */
  writable = true;
  probed = true;

  // ---- 图数据 ----
  nodeCache = new Map<string, Concept>();
  /** 本文范围下的成员身份（direct / endpoint_context）。 */
  membershipById = new Map<string, 'direct' | 'endpoint_context'>();
  visibleIds: string[] = [];
  nodeCursor: string | null = null;
  hasMoreNodes = false;
  graphRevision = 0;
  edges: ConceptRelation[] = [];
  edgesComplete = false;
  loading = false;
  error: string | null = null;
  /** graphRevision 冲突后的提示（数据已重载）。 */
  revisionNotice = false;

  // ---- 列表模式 ----
  listItems: Concept[] = [];
  listCursor: string | null = null;
  listLoading = false;

  // ---- 交互状态 ----
  viewMode: ConceptViewMode = 'graph';
  query = '';
  filter: ConceptFilter = 'all';
  selected: ConceptTarget | null = null;
  /** 联动高亮（不改变相机/选择）。 */
  highlightConceptIds = new Set<string>();
  highlightRelationIds = new Set<string>();
  detail: ConceptDetail | ConceptRelationDetail | null = null;
  detailLoading = false;
  positions = new Map<string, { x: number; y: number }>();
  viewport = { x: 0, y: 0, zoom: 1 };
  /** 焦点概念（邻居展开）。 */
  focusId: string | null = null;

  // ---- 批次 ----
  batch: ConceptBatch | null = null;
  batchPhase: 'idle' | 'generating' | 'ready' | 'committing' | 'done' | 'error' = 'idle';
  batchError: string | null = null;
  choiceState: DraftChoiceState | null = null;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private batchGen = 0;

  // ---- 编辑 ----
  matches: ConceptMatch[] = [];
  private syncUnsub: (() => void) | null = null;
  /** 选词「收为概念」的预填名；面板消费后清空。 */
  createPrefill: string | null = null;
  bootGen = 0;

  private get requestGenKey(): string {
    return `${this.topicId ?? ''}:${this.documentId ?? ''}`;
  }

  get visibleConcepts(): Concept[] {
    return this.visibleIds
      .map((id) => this.nodeCache.get(id))
      .filter((concept): concept is Concept => concept !== undefined);
  }

  get filteredEdges(): ConceptRelation[] {
    return this.edges;
  }

  private subscribeSync(): void {
    if (this.syncUnsub) return;
    try {
      const sync = this.resolve(SyncService);
      this.syncUnsub = sync.subscribe((event) => {
        void this.handleSync(event);
      });
    } catch {
      // SyncService 未挂（测试环境等），退化为不订阅
    }
  }

  /** 概念变更或断线补偿只重载图数据，不改视口、筛选、选中、草稿与高亮。 */
  async handleSync(event: SyncEvent): Promise<void> {
    if (!this.enabled || !this.topicId) return;
    if (event.type === 'reset') {
      await this.loadGraph({ focusId: this.focusId });
      return;
    }
    if (event.type !== 'changes') return;
    if (!event.changes.some((change) => change.scope === 'concept')) return;
    await this.loadGraph({ focusId: this.focusId });
  }

  /** 写开关关闭时记下错误。返回 false 时调用方不要发请求。 */
  allowWrite(): boolean {
    if (this.writable) return true;
    this.error = READONLY_ERROR;
    return false;
  }

  async boot(topicId: string, documentId: string | null): Promise<void> {
    const gen = ++this.bootGen;
    this.subscribeSync();
    this.topicId = topicId;
    this.documentId = documentId;
    this.nodeCache = new Map();
    this.membershipById = new Map();
    this.visibleIds = [];
    this.nodeCursor = null;
    this.edges = [];
    this.edgesComplete = false;
    this.selected = null;
    this.detail = null;
    this.focusId = null;
    this.revisionNotice = false;
    this.error = null;
    if (gen !== this.bootGen) return;
    await this.loadGraph();
  }

  /** 后发的 loadGraph 作废先发的响应，避免同步重载盖掉刚收录的节点。 */
  private loadGen = 0;

  /** 节点发现分页（最多两页缓存；可见集合最多 50）。 */
  async loadGraph(opts?: { focusId?: string | null; append?: boolean }): Promise<void> {
    const topicId = this.topicId;
    if (!topicId || !this.enabled) return;
    const gen = this.bootGen;
    const loadGen = ++this.loadGen;
    this.loading = true;
    this.error = null;
    try {
      const page = await api.getConceptGraph(topicId, {
        ...(opts?.focusId ? { focusId: opts.focusId } : {}),
        ...(this.documentId && !opts?.focusId ? { documentId: this.documentId } : {}),
        ...(opts?.append && this.nodeCursor ? { cursor: this.nodeCursor } : {}),
        limit: 50,
      });
      if (gen !== this.bootGen || loadGen !== this.loadGen) return;
      for (const node of page.nodes) {
        this.nodeCache.set(node.concept.id, node.concept);
        this.membershipById.set(node.concept.id, node.membership);
      }
      this.graphRevision = page.graphRevision;
      this.nodeCursor = page.nextCursor;
      this.hasMoreNodes = page.nextCursor !== null;
      if (opts?.focusId) {
        this.focusId = opts.focusId;
        this.visibleIds = page.nodes.map((node) => node.concept.id).slice(0, 50);
      } else if (!opts?.append) {
        this.visibleIds = page.nodes.map((node) => node.concept.id).slice(0, 50);
      } else {
        this.visibleIds = [...this.visibleIds, ...page.nodes.map((node) => node.concept.id)].slice(0, 50);
      }
      await this.refreshEdges();
    } catch (err) {
      if (gen !== this.bootGen || loadGen !== this.loadGen) return;
      this.error = err instanceof ApiError ? err.message : '概念图加载失败';
    } finally {
      if (gen === this.bootGen && loadGen === this.loadGen) this.loading = false;
    }
  }

  /** 可见集合的完整关系分页；revision 冲突时重载数据但保留焦点与相机。 */
  async refreshEdges(): Promise<void> {
    const topicId = this.topicId;
    const loadGen = this.loadGen;
    if (!topicId || this.visibleIds.length === 0) {
      if (loadGen === this.loadGen) {
        this.edges = [];
        this.edgesComplete = true;
      }
      return;
    }
    const gen = this.bootGen;
    this.edgesComplete = false;
    try {
      const collected: ConceptRelation[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await api.postConceptGraphView(topicId, {
          ...(this.documentId ? { documentId: this.documentId } : {}),
          nodeIds: this.visibleIds,
          expectedGraphRevision: this.graphRevision,
          ...(cursor ? { edgeCursor: cursor } : {}),
        });
        if (gen !== this.bootGen || loadGen !== this.loadGen) return;
        collected.push(...page.edges);
        if (!page.nextEdgeCursor) break;
        cursor = page.nextEdgeCursor;
      }
      if (loadGen !== this.loadGen) return;
      this.edges = collected;
      this.edgesComplete = true;
      this.revisionNotice = false;
    } catch (err) {
      if (gen !== this.bootGen || loadGen !== this.loadGen) return;
      if (err instanceof ApiError && err.code === 'GRAPH_VIEW_CHANGED') {
        // 图已变化：重载节点与关系，保留当前相机/焦点
        this.revisionNotice = true;
        await this.loadGraph({ focusId: this.focusId });
        return;
      }
      this.edgesComplete = false;
      this.error = err instanceof ApiError ? err.message : '关系加载失败';
    }
  }

  async loadList(reset = true): Promise<void> {
    const topicId = this.topicId;
    if (!topicId) return;
    const gen = this.bootGen;
    this.listLoading = true;
    try {
      const page = await api.listConcepts(topicId, {
        ...(this.query ? { q: this.query } : {}),
        ...(!reset && this.listCursor ? { cursor: this.listCursor } : {}),
        limit: 50,
      });
      if (gen !== this.bootGen) return;
      this.listItems = reset ? page.items : [...this.listItems, ...page.items];
      this.listCursor = page.nextCursor;
    } finally {
      if (gen === this.bootGen) this.listLoading = false;
    }
  }

  setQuery(query: string): void {
    this.query = query;
    if (this.viewMode === 'list') void this.loadList(true);
  }

  async select(target: ConceptTarget | null): Promise<void> {
    this.selected = target;
    this.detail = null;
    if (!target) return;
    this.detailLoading = true;
    try {
      this.detail =
        target.kind === 'concept'
          ? await api.getConcept(target.id)
          : await api.getConceptRelation(target.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this.selected = null;
      }
      this.error = err instanceof ApiError ? err.message : '详情加载失败';
    } finally {
      this.detailLoading = false;
    }
  }

  setHighlight(concepts: Set<string>, relations: Set<string>): void {
    this.highlightConceptIds = concepts;
    this.highlightRelationIds = relations;
  }

  async expandNeighbors(conceptId: string): Promise<void> {
    await this.loadGraph({ focusId: conceptId });
  }

  async createConcept(input: CreateConceptInput): Promise<CreateConceptResult> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    const topicId = this.topicId;
    if (!topicId) throw new Error('no topic');
    const result = await api.createConcept(topicId, input);
    // 文章工作区新建的概念必须写入本文引用，否则按 documentId 重载会把节点刷掉。
    if (this.documentId) {
      await api.setDocumentKnowledgeRef(this.documentId, {
        topicId,
        targetKind: 'concept',
        targetId: result.concept.id,
        requestId: crypto.randomUUID(),
      });
      await this.loadGraph();
      return result;
    }
    this.nodeCache.set(result.concept.id, result.concept);
    if (this.visibleIds.length < 50) this.visibleIds = [...this.visibleIds, result.concept.id];
    this.graphRevision += 1;
    await this.refreshEdges();
    return result;
  }

  async saveBundle(input: Omit<SaveConceptBundleInput, 'requestId'>) {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    const topicId = this.topicId;
    if (!topicId) throw new Error('no topic');
    const documentId = input.documentId ?? this.documentId ?? undefined;
    const result = await api.saveConceptBundle(topicId, {
      ...input,
      ...(documentId ? { documentId } : {}),
      requestId: crypto.randomUUID(),
    });
    await this.loadGraph({ focusId: this.focusId });
    return result;
  }

  async updateConcept(id: string, input: UpdateConceptInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    const updated = await api.updateConcept(id, input);
    this.nodeCache.set(id, updated);
    if (this.detail && 'concept' in this.detail && this.detail.concept.id === id) {
      this.detail = { ...this.detail, concept: updated };
    }
    this.graphRevision += 1;
    await this.refreshEdges();
  }

  async updateRelation(id: string, input: UpdateConceptRelationInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.updateConceptRelation(id, input);
    this.graphRevision += 1;
    await this.refreshEdges();
    if (this.selected?.kind === 'relation' && this.selected.id === id) {
      this.detail = await api.getConceptRelation(id);
    }
  }

  async archiveConcept(id: string, expectedVersion: number): Promise<void> {
    if (!this.allowWrite()) return;
    await api.archiveConcept(id, expectedVersion);
    this.nodeCache.delete(id);
    this.visibleIds = this.visibleIds.filter((visibleId) => visibleId !== id);
    if (this.selected?.kind === 'concept' && this.selected.id === id) {
      this.selected = null;
      this.detail = null;
    }
    this.graphRevision += 1;
    await this.refreshEdges();
  }

  async restoreConcept(id: string, expectedVersion: number): Promise<void> {
    if (!this.allowWrite()) return;
    await api.restoreConcept(id, expectedVersion);
    await this.loadGraph({ focusId: this.focusId });
  }

  async archiveRelation(id: string, expectedVersion: number): Promise<void> {
    if (!this.allowWrite()) return;
    await api.archiveConceptRelation(id, expectedVersion);
    if (this.selected?.kind === 'relation' && this.selected.id === id) {
      this.selected = null;
      this.detail = null;
    }
    this.graphRevision += 1;
    await this.refreshEdges();
  }

  async searchMatches(name: string): Promise<void> {
    const topicId = this.topicId;
    if (!topicId || name.trim() === '') {
      this.matches = [];
      return;
    }
    const result = await api.findConceptMatches(topicId, { name });
    this.matches = result.matches;
  }

  // ---- 批次流程 ----

  async startGeneration(scope: 'document' | 'selection', selection?: { fromBlockIndex: number; toBlockIndex: number }): Promise<void> {
    if (!this.allowWrite()) return;
    const topicId = this.topicId;
    const documentId = this.documentId;
    if (!topicId || !documentId) return;
    const gen = ++this.batchGen;
    this.batchPhase = 'generating';
    this.batchError = null;
    try {
      const result = await api.createConceptBatch(documentId, {
        topicId,
        scope,
        ...(selection ? { selection } : {}),
        requestId: crypto.randomUUID(),
      });
      if (gen !== this.batchGen) return;
      await this.loadBatch(result.batchId);
    } catch (err) {
      if (gen !== this.batchGen) return;
      this.batchPhase = 'error';
      this.batchError = err instanceof ApiError ? err.message : '生成任务创建失败';
    }
  }

  /** 打开已有批次（含对话动作卡恢复）。 */
  async loadBatch(batchId: string): Promise<void> {
    const gen = ++this.batchGen;
    this.stopBatchPolling();
    const poll = async () => {
      try {
        const batch = await api.getConceptBatch(batchId);
        if (gen !== this.batchGen) return;
        this.batch = batch;
        if (batch.status === 'ready') {
          this.batchPhase = 'ready';
          this.choiceState = this.choiceState ?? (batch.draft ? defaultChoiceState(batch.draft) : null);
          this.stopBatchPolling();
          return;
        }
        if (batch.status === 'failed' || batch.status === 'cancelled') {
          this.batchPhase = 'error';
          this.batchError = batch.errorCode ? `生成失败（${batch.errorCode}）` : '生成已取消';
          this.stopBatchPolling();
          return;
        }
        this.batchPhase = 'generating';
      } catch (err) {
        if (gen !== this.batchGen) return;
        this.batchPhase = 'error';
        this.batchError = err instanceof ApiError ? err.message : '批次加载失败';
        this.stopBatchPolling();
      }
    };
    await poll();
    if (this.batchPhase === 'generating') {
      this.batchTimer = setInterval(() => void poll(), 1500);
    }
  }

  private stopBatchPolling(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  get draft(): ConceptDraft | null {
    return this.batch?.draft ?? null;
  }

  patchChoice(patch: (state: DraftChoiceState) => DraftChoiceState): void {
    if (!this.choiceState || !this.draft) return;
    this.choiceState = patch(this.choiceState);
  }

  chooseDraftConcept(tempId: string, choice: DraftChoiceState['concepts'][string]): void {
    if (!this.draft) return;
    this.patchChoice((state) => chooseConcept(this.draft!, state, tempId, choice));
  }

  chooseDraftRelation(tempId: string, chosen: boolean): void {
    this.patchChoice((state) => chooseRelation(state, tempId, chosen));
  }

  rebindDraftRelation(tempId: string, patch: Parameters<typeof rebindRelation>[2]): void {
    this.patchChoice((state) => rebindRelation(state, tempId, patch));
  }

  acknowledgeDraft(tempId: string): void {
    this.patchChoice((state) => ({
      ...state,
      acknowledged: { ...state.acknowledged, [tempId]: true },
    }));
  }

  async commitBatch(): Promise<void> {
    if (!this.allowWrite()) return;
    const batch = this.batch;
    const draft = this.draft;
    const state = this.choiceState;
    if (!batch || !draft || !state) return;
    const plan = buildCommitPlan(draft, state);
    if (plan.unconfirmedInferred.length > 0) {
      this.batchError = '还有推断项未确认';
      return;
    }
    this.batchPhase = 'committing';
    this.batchError = null;
    try {
      const input: CommitConceptBatchInput = {
        expectedDraftRevision: batch.draftRevision,
        conceptDecisions: plan.conceptDecisions,
        relationDecisions: plan.relationDecisions,
        requestId: crypto.randomUUID(),
      };
      const result = await api.commitConceptBatch(batch.id, input);
      this.batchPhase = 'done';
      this.batch = { ...batch, status: 'committed', commitResult: result };
      this.choiceState = null;
      this.stopBatchPolling();
      await this.loadGraph({ focusId: this.focusId });
    } catch (err) {
      this.batchPhase = 'ready';
      this.batchError = err instanceof ApiError ? err.message : '收录失败';
      if (err instanceof ApiError && (err.code === 'CONCEPT_BATCH_CONFLICT' || err.code === 'CONCEPT_BATCH_STALE')) {
        // 版本/正文冲突：重载批次，保留本地编辑由服务端版本决定
        await this.loadBatch(batch.id);
      }
    }
  }

  async discardBatch(): Promise<void> {
    if (!this.allowWrite()) return;
    if (!this.batch) return;
    try {
      await api.discardConceptBatch(this.batch.id);
    } catch {
      // 已丢弃/状态变化都按关闭处理
    }
    this.closeBatch();
  }

  async refreshPractice(id: string, input: RefreshConceptPracticeInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.refreshConceptPractice(id, input);
  }

  async resumePractice(id: string, input: ResumeConceptPracticeInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.resumeConceptPractice(id, input);
  }

  async unbindPractice(id: string): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.unbindConceptPractice(id);
  }

  async proposePractice(input: CreateConceptPracticeProposalInput): Promise<string> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    const { proposalId } = await api.createConceptPracticeProposal(input);
    return proposalId;
  }

  async createPractice(input: CreateConceptPracticeInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.createConceptPractice(input);
  }

  async bindExistingPractice(input: BindExistingConceptPracticeInput): Promise<void> {
    if (!this.allowWrite()) throw new Error(READONLY_ERROR);
    await api.bindExistingConceptPractice(input);
  }

  closeBatch(): void {
    this.batchGen += 1;
    this.stopBatchPolling();
    this.batch = null;
    this.choiceState = null;
    this.batchPhase = 'idle';
    this.batchError = null;
  }

  get commitSummary(): string | null {
    const counts = this.batch?.commitResult?.counts;
    if (!counts) return null;
    const parts: string[] = [];
    if (counts.createdConcepts > 0) parts.push(`新增 ${counts.createdConcepts} 个概念`);
    if (counts.reusedConcepts > 0) parts.push(`补充 ${counts.reusedConcepts} 个已有概念`);
    if (counts.createdRelations > 0) parts.push(`新增 ${counts.createdRelations} 条关系`);
    if (counts.supplementedRelations > 0) parts.push(`补充 ${counts.supplementedRelations} 条关系`);
    return parts.length > 0 ? `已收录：${parts.join('，')}` : '已收录';
  }

  dispose(): void {
    this.stopBatchPolling();
    this.syncUnsub?.();
    this.syncUnsub = null;
  }
}

export type { DocumentKnowledge };
