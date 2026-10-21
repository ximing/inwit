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
import { pushFocus, type FocusFrame } from './concept-graph-nav.js';

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
  /** 展开路径。栈顶是上一层的焦点、名字和当时的视口，返回时还原。 */
  focusStack: FocusFrame[] = [];
  /** 进入下一层后，图按这一层重新取景，并把这个概念放在中央。nonce 用来重复触发。 */
  centerRequest: { id: string; nonce: number } | null = null;

  // ---- 批次 ----
  batch: ConceptBatch | null = null;
  batchPhase: 'idle' | 'generating' | 'ready' | 'committing' | 'done' | 'error' = 'idle';
  batchError: string | null = null;
  choiceState: DraftChoiceState | null = null;
  /** 进行中的候选按文章分开。切走只是先收起，回到该文再续上。 */
  private batchesByDocument = new Map<string, DocumentBatchState>();
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private batchGen = 0;

  // ---- 编辑 ----
  matches: ConceptMatch[] = [];
  private syncUnsub: (() => void) | null = null;
  /** 选词「收为概念」的预填名。跟文章走，关闭对话框时清空。 */
  createPrefill: string | null = null;
  /** 新建概念 / 连接概念对话框。跟文章走，避免在下一篇里继续创建。 */
  editor: 'concept' | 'relation' | null = null;
  linkDraft: { fromId: string; toId: string } | null = null;
  conceptForm: ConceptFormDraft | null = null;
  relationForm: RelationFormDraft | null = null;
  linkForm: LinkFormDraft | null = null;
  /** 图视图、筛选、草稿按文章分开。同一篇再次 boot 不换相机对象。 */
  private viewsByDocument = new Map<string, DocumentViewState>();
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

  /** 根层在路径上的名字。文章里是全文，主题汇总里是全部。 */
  get scopeLabel(): string {
    return this.documentId ? '全文' : '全部';
  }

  /** 从根到当前层的路径。最后一项是当前层。 */
  get focusCrumbs(): { label: string }[] {
    const current = this.focusId
      ? (this.nodeCache.get(this.focusId)?.name ?? '当前')
      : this.scopeLabel;
    if (this.focusStack.length === 0) return [{ label: current }];
    return [...this.focusStack.map((frame) => ({ label: frame.label })), { label: current }];
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
    const previousDocumentId = this.documentId;
    const switchingDocument = previousDocumentId !== documentId;
    if (switchingDocument && previousDocumentId) {
      this.rememberDocumentBatch(previousDocumentId);
      this.rememberDocumentView(previousDocumentId);
      this.batchGen += 1;
      this.stopBatchPolling();
    }
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
    if (switchingDocument) {
      this.restoreDocumentBatch(documentId);
      this.restoreDocumentView(documentId);
    } else {
      this.selected = null;
      this.detail = null;
      this.focusId = null;
      this.revisionNotice = false;
      this.error = null;
    }
    if (gen !== this.bootGen) return;
    await this.loadGraph(this.focusId ? { focusId: this.focusId } : undefined);
    if (gen !== this.bootGen || this.documentId !== documentId) return;
    if (switchingDocument && this.viewMode === 'list') await this.loadList(true);
    if (gen !== this.bootGen || this.documentId !== documentId) return;
    // 选中被 restoreDocumentView 恢复后不再回拉详情：信息卡直接够用。
    await this.resumeDocumentBatch(documentId);
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
      if (opts && 'focusId' in opts) this.focusId = opts.focusId ?? null;
      if (opts?.focusId) {
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

  /** 选中是轻操作：只记目标并关掉旧详情；详情由 openDetail 显式拉取。 */
  select(target: ConceptTarget | null): void {
    this.selected = target;
    this.detail = null;
    this.detailLoading = false;
  }

  /** 拉取当前选中目标的完整详情（出处、练习、编辑所需）；可带 target 先选中。 */
  async openDetail(target?: ConceptTarget): Promise<void> {
    if (target !== undefined) this.select(target);
    const current = this.selected;
    if (!current) return;
    this.detailLoading = true;
    try {
      this.detail =
        current.kind === 'concept'
          ? await api.getConcept(current.id)
          : await api.getConceptRelation(current.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this.selected = null;
      }
      this.error = err instanceof ApiError ? err.message : '详情加载失败';
    } finally {
      this.detailLoading = false;
    }
  }

  /** 只关详情浮层，保留选中（信息卡还在）。 */
  closeDetail(): void {
    this.detail = null;
    this.detailLoading = false;
  }

  setHighlight(concepts: Set<string>, relations: Set<string>): void {
    this.highlightConceptIds = concepts;
    this.highlightRelationIds = relations;
  }

  ensureConceptForm(): ConceptFormDraft {
    if (!this.conceptForm) {
      this.conceptForm = {
        name: this.createPrefill ?? '',
        sense: '',
        definition: '',
        aliases: '',
      };
    }
    return this.conceptForm;
  }

  patchConceptForm(patch: Partial<ConceptFormDraft>): void {
    this.conceptForm = { ...this.ensureConceptForm(), ...patch };
  }

  openConceptEditor(): void {
    this.editor = 'concept';
    this.ensureConceptForm();
  }

  closeConceptEditor(): void {
    this.editor = null;
    this.createPrefill = null;
    this.conceptForm = null;
    this.matches = [];
  }

  ensureRelationForm(): RelationFormDraft {
    if (!this.relationForm) {
      this.relationForm = {
        fromId: '',
        toId: '',
        predicate: '',
        kind: 'other',
        context: '',
      };
    }
    return this.relationForm;
  }

  patchRelationForm(patch: Partial<RelationFormDraft>): void {
    this.relationForm = { ...this.ensureRelationForm(), ...patch };
  }

  openRelationEditor(): void {
    this.editor = 'relation';
    this.ensureRelationForm();
  }

  closeRelationEditor(): void {
    this.editor = null;
    this.relationForm = null;
  }

  openLinkDraft(fromId: string, toId: string): void {
    const same = this.linkDraft?.fromId === fromId && this.linkDraft.toId === toId;
    this.linkDraft = { fromId, toId };
    if (!same || !this.linkForm) this.linkForm = { predicate: '', kind: 'other' };
  }

  patchLinkForm(patch: Partial<LinkFormDraft>): void {
    this.linkForm = { ...(this.linkForm ?? { predicate: '', kind: 'other' }), ...patch };
  }

  closeLinkDraft(): void {
    this.linkDraft = null;
    this.linkForm = null;
  }

  async expandNeighbors(conceptId: string): Promise<void> {
    const frame: FocusFrame = {
      focusId: this.focusId,
      label: this.focusId ? (this.nodeCache.get(this.focusId)?.name ?? '上一层') : this.scopeLabel,
      viewport: { ...this.viewport },
    };
    const pushed = this.focusId !== conceptId;
    if (pushed) this.focusStack = pushFocus(this.focusStack, frame, conceptId);
    await this.loadGraph({ focusId: conceptId });
    if (this.focusId !== conceptId) {
      if (pushed && this.focusStack.at(-1)?.focusId === frame.focusId) {
        this.focusStack = this.focusStack.slice(0, -1);
      }
      return;
    }
    this.centerRequest = { id: conceptId, nonce: (this.centerRequest?.nonce ?? 0) + 1 };
    if (this.selected?.kind !== 'concept' || this.selected.id !== conceptId) {
      this.select({ kind: 'concept', id: conceptId });
    }
  }

  /** 回到路径上的某一层，并还原离开那一层时的视口。 */
  async jumpFocus(index: number): Promise<void> {
    if (index < 0 || index >= this.focusStack.length) return;
    const frame = this.focusStack[index]!;
    this.focusStack = this.focusStack.slice(0, index);
    await this.loadGraph({ focusId: frame.focusId });
    if (this.focusId !== frame.focusId) return;
    this.viewport = frame.viewport;
    this.centerRequest = null;
  }

  /** 从展开的下一层回到上一层，并还原离开时的视口。 */
  async backFocus(): Promise<void> {
    await this.jumpFocus(this.focusStack.length - 1);
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
    this.publishDocumentBatch(documentId, {
      batch: null,
      batchPhase: 'generating',
      batchError: null,
      choiceState: null,
      pendingBatchId: null,
    });
    try {
      const result = await api.createConceptBatch(documentId, {
        topicId,
        scope,
        ...(selection ? { selection } : {}),
        requestId: crypto.randomUUID(),
      });
      const current = this.batchesByDocument.get(documentId);
      if (!current || current.batchPhase !== 'generating') return;
      this.publishDocumentBatch(documentId, { ...current, pendingBatchId: result.batchId });
      if (this.documentId === documentId) await this.loadBatch(result.batchId);
    } catch (err) {
      const current = this.batchesByDocument.get(documentId);
      if (!current || current.batchPhase !== 'generating') return;
      this.publishDocumentBatch(documentId, {
        batch: current.batch,
        batchPhase: 'error',
        batchError: err instanceof ApiError ? err.message : '生成任务创建失败',
        choiceState: current.choiceState,
        pendingBatchId: null,
      });
    }
  }

  /** 打开已有批次（含对话动作卡恢复）。结果写回批次所属文章，不盖到当前打开的另一篇。 */
  async loadBatch(batchId: string): Promise<void> {
    const gen = ++this.batchGen;
    this.stopBatchPolling();
    const poll = async () => {
      try {
        const batch = await api.getConceptBatch(batchId);
        if (gen !== this.batchGen) return;
        const owner = batch.documentId ?? this.ownerOfBatch(batchId) ?? this.documentId;
        if (!owner) return;
        const prev = this.batchesByDocument.get(owner);
        const keptChoice = this.documentId === owner ? this.choiceState ?? prev?.choiceState ?? null : prev?.choiceState ?? null;
        if (batch.status === 'ready') {
          this.publishDocumentBatch(owner, {
            batch,
            batchPhase: 'ready',
            batchError: null,
            choiceState: keptChoice ?? (batch.draft ? defaultChoiceState(batch.draft) : null),
            pendingBatchId: null,
          });
          this.stopBatchPolling();
          return;
        }
        if (batch.status === 'failed' || batch.status === 'cancelled') {
          this.publishDocumentBatch(owner, {
            batch,
            batchPhase: 'error',
            batchError: batch.errorCode ? `生成失败（${batch.errorCode}）` : '生成已取消',
            choiceState: keptChoice,
            pendingBatchId: null,
          });
          this.stopBatchPolling();
          return;
        }
        this.publishDocumentBatch(owner, {
          batch,
          batchPhase: 'generating',
          batchError: null,
          choiceState: keptChoice,
          pendingBatchId: null,
        });
      } catch (err) {
        if (gen !== this.batchGen) return;
        const owner = this.ownerOfBatch(batchId) ?? this.documentId;
        if (!owner) return;
        const prev = this.batchesByDocument.get(owner);
        this.publishDocumentBatch(owner, {
          batch: prev?.batch ?? null,
          batchPhase: 'error',
          batchError: err instanceof ApiError ? err.message : '批次加载失败',
          choiceState: prev?.choiceState ?? null,
          pendingBatchId: null,
        });
        this.stopBatchPolling();
      }
    };
    await poll();
    if (gen !== this.batchGen) return;
    const owner = this.ownerOfBatch(batchId);
    if (owner && this.documentId === owner && this.batchesByDocument.get(owner)?.batchPhase === 'generating') {
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
    const documentId = this.batch?.documentId ?? this.documentId;
    if (!documentId) return;
    const prev = this.batchesByDocument.get(documentId);
    if (prev) this.batchesByDocument.set(documentId, { ...prev, choiceState: this.choiceState });
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
    const documentId = batch.documentId ?? this.documentId;
    const plan = buildCommitPlan(draft, state);
    if (plan.unconfirmedInferred.length > 0) {
      this.batchError = '还有推断项未确认';
      return;
    }
    this.batchPhase = 'committing';
    this.batchError = null;
    if (documentId) {
      const prev = this.batchesByDocument.get(documentId);
      if (prev) this.publishDocumentBatch(documentId, { ...prev, batchPhase: 'committing', batchError: null });
    }
    try {
      const input: CommitConceptBatchInput = {
        expectedDraftRevision: batch.draftRevision,
        conceptDecisions: plan.conceptDecisions,
        relationDecisions: plan.relationDecisions,
        requestId: crypto.randomUUID(),
      };
      const result = await api.commitConceptBatch(batch.id, input);
      const done: DocumentBatchState = {
        batch: { ...batch, status: 'committed', commitResult: result },
        batchPhase: 'done',
        batchError: null,
        choiceState: null,
        pendingBatchId: null,
      };
      if (documentId) this.publishDocumentBatch(documentId, done);
      else this.applyBatch(done);
      this.stopBatchPolling();
      if (this.documentId === documentId) await this.loadGraph({ focusId: this.focusId });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '收录失败';
      if (documentId) {
        const prev = this.batchesByDocument.get(documentId);
        this.publishDocumentBatch(documentId, {
          batch: prev?.batch ?? batch,
          batchPhase: 'ready',
          batchError: message,
          choiceState: prev?.choiceState ?? state,
          pendingBatchId: null,
        });
      } else {
        this.batchPhase = 'ready';
        this.batchError = message;
      }
      if (err instanceof ApiError && (err.code === 'CONCEPT_BATCH_CONFLICT' || err.code === 'CONCEPT_BATCH_STALE')) {
        // 版本/正文冲突：重载批次，保留本地编辑由服务端版本决定
        await this.loadBatch(batch.id);
      }
    }
  }

  async discardBatch(): Promise<void> {
    if (!this.allowWrite()) return;
    const batch = this.batch;
    if (!batch) return;
    const documentId = batch.documentId ?? this.documentId;
    try {
      await api.discardConceptBatch(batch.id);
    } catch {
      // 已丢弃/状态变化都按关闭处理
    }
    this.batchGen += 1;
    this.stopBatchPolling();
    if (documentId) this.batchesByDocument.delete(documentId);
    if (this.documentId === documentId) this.clearLiveBatch();
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
    const documentId = this.batch?.documentId ?? this.documentId;
    this.batchGen += 1;
    this.stopBatchPolling();
    if (documentId) this.batchesByDocument.delete(documentId);
    if (!documentId || this.documentId === documentId) this.clearLiveBatch();
  }

  /** 切走前把当前文章的图视图和未提交草稿收进自己的格子。 */
  private rememberDocumentView(documentId: string): void {
    this.viewsByDocument.set(documentId, {
      viewport: this.viewport,
      positions: this.positions,
      focusId: this.focusId,
      focusStack: this.focusStack,
      selected: this.selected,
      viewMode: this.viewMode,
      filter: this.filter,
      query: this.query,
      createPrefill: this.createPrefill,
      editor: this.editor,
      linkDraft: this.linkDraft,
      conceptForm: this.conceptForm,
      relationForm: this.relationForm,
      linkForm: this.linkForm,
    });
  }

  /** 打开文章时露出这篇自己的视图；没有就回到默认。高亮跟卡片走，不在这里恢复。 */
  private restoreDocumentView(documentId: string | null): void {
    const saved = documentId ? this.viewsByDocument.get(documentId) : undefined;
    if (saved) {
      this.viewport = saved.viewport;
      this.positions = saved.positions;
      this.focusId = saved.focusId;
      this.focusStack = saved.focusStack;
      this.centerRequest = null;
      this.selected = saved.selected;
      this.viewMode = saved.viewMode;
      this.filter = saved.filter;
      this.query = saved.query;
      this.createPrefill = saved.createPrefill;
      this.editor = saved.editor;
      this.linkDraft = saved.linkDraft;
      this.conceptForm = saved.conceptForm;
      this.relationForm = saved.relationForm;
      this.linkForm = saved.linkForm;
    } else {
      this.viewport = { x: 0, y: 0, zoom: 1 };
      this.positions = new Map();
      this.focusId = null;
      this.focusStack = [];
      this.centerRequest = null;
      this.selected = null;
      this.viewMode = 'graph';
      this.filter = 'all';
      this.query = '';
      this.createPrefill = null;
      this.editor = null;
      this.linkDraft = null;
      this.conceptForm = null;
      this.relationForm = null;
      this.linkForm = null;
    }
    this.detail = null;
    this.detailLoading = false;
    this.highlightConceptIds = new Set();
    this.highlightRelationIds = new Set();
    this.matches = [];
    this.listItems = [];
    this.listCursor = null;
    this.listLoading = false;
    this.error = null;
    this.revisionNotice = false;
  }

  /** 切走前把当前文章的候选收进自己的格子。 */
  private rememberDocumentBatch(documentId: string): void {
    const pendingBatchId = this.batch?.id ?? this.batchesByDocument.get(documentId)?.pendingBatchId ?? null;
    this.writeDocumentBatch(documentId, {
      batch: this.batch,
      batchPhase: this.batchPhase,
      batchError: this.batchError,
      choiceState: this.choiceState,
      pendingBatchId,
    });
  }

  /** 打开文章时露出这篇自己的候选；没有就回到空闲。 */
  private restoreDocumentBatch(documentId: string | null): void {
    if (!documentId) {
      this.clearLiveBatch();
      return;
    }
    const saved = this.batchesByDocument.get(documentId);
    if (saved) this.applyBatch(saved);
    else this.clearLiveBatch();
  }

  /** 生成还没结束时，回到该文再接着问进度。 */
  private async resumeDocumentBatch(documentId: string | null): Promise<void> {
    if (!documentId || this.documentId !== documentId) return;
    const saved = this.batchesByDocument.get(documentId);
    if (!saved || saved.batchPhase !== 'generating') return;
    const batchId = saved.batch?.id ?? saved.pendingBatchId;
    if (!batchId) return;
    await this.loadBatch(batchId);
  }

  private publishDocumentBatch(documentId: string, state: DocumentBatchState): void {
    this.writeDocumentBatch(documentId, state);
    if (this.documentId === documentId) this.applyBatch(state);
  }

  private writeDocumentBatch(documentId: string, state: DocumentBatchState): void {
    if (state.batchPhase === 'idle' && !state.batch && !state.pendingBatchId) {
      this.batchesByDocument.delete(documentId);
      return;
    }
    this.batchesByDocument.set(documentId, state);
  }

  private applyBatch(state: DocumentBatchState): void {
    this.batch = state.batch;
    this.batchPhase = state.batchPhase;
    this.batchError = state.batchError;
    this.choiceState = state.choiceState;
  }

  private clearLiveBatch(): void {
    this.batch = null;
    this.batchPhase = 'idle';
    this.batchError = null;
    this.choiceState = null;
  }

  private ownerOfBatch(batchId: string): string | null {
    for (const [documentId, state] of this.batchesByDocument) {
      if (state.batch?.id === batchId || state.pendingBatchId === batchId) return documentId;
    }
    return null;
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

interface DocumentBatchState {
  batch: ConceptBatch | null;
  batchPhase: ConceptsService['batchPhase'];
  batchError: string | null;
  choiceState: DraftChoiceState | null;
  /** 创建请求已经返回、轮询还没挂上。切走后靠它续上。 */
  pendingBatchId: string | null;
}

export type ConceptRelationKind =
  | 'composition'
  | 'execution'
  | 'evaluation'
  | 'dependency'
  | 'contrast'
  | 'other';

export interface ConceptFormDraft {
  name: string;
  sense: string;
  definition: string;
  aliases: string;
}

export interface RelationFormDraft {
  fromId: string;
  toId: string;
  predicate: string;
  kind: ConceptRelationKind;
  context: string;
}

export interface LinkFormDraft {
  predicate: string;
  kind: ConceptRelationKind;
}

interface DocumentViewState {
  viewport: { x: number; y: number; zoom: number };
  positions: Map<string, { x: number; y: number }>;
  focusId: string | null;
  focusStack: FocusFrame[];
  selected: ConceptTarget | null;
  viewMode: ConceptViewMode;
  filter: ConceptFilter;
  query: string;
  createPrefill: string | null;
  editor: 'concept' | 'relation' | null;
  linkDraft: { fromId: string; toId: string } | null;
  conceptForm: ConceptFormDraft | null;
  relationForm: RelationFormDraft | null;
  linkForm: LinkFormDraft | null;
}

export type { DocumentKnowledge };
