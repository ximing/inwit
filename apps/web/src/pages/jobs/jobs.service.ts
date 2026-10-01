import { Service } from '@rabjs/react';
import type {
  AgentExecution,
  Job,
  JobQueue,
  JobQueueCounts,
  JobStatus,
  JobType,
  JobUsage,
  SyncChange,
} from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import {
  cancelJob,
  getJob,
  getJobQueue,
  getJobUsage,
  listJobExecutions,
  listJobs,
  retryJob,
} from '@/api/jobs';
import { formatTimeHm } from '@/lib/format';
import {
  coalesceChanges,
  planReloads,
  stripEchoes,
  type EchoStamp,
  type SyncView,
} from '@/lib/sync-plan';
import { SyncService, type SyncEvent } from '@/services/sync.service';

const POLL_MS = 5000;
const TICK_MS = 1000;
const HISTORY_LIMIT = 20;
const FAILED_LIMIT = 3;
const RECENT_LIMIT = 8;

export const JOB_TYPES: JobType[] = [
  'digest',
  'evolve',
  'weekly_report',
  'topic',
  'chat',
  'selection',
  'extract',
  'ocr',
  'annotation_resurface',
  'memory_organize',
  'conversation',
];
export const JOB_STATUSES: JobStatus[] = ['pending', 'running', 'done', 'failed'];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  digest: '消化',
  chat: '对话',
  weekly_report: '周报',
  evolve: '进化',
  topic: '主题',
  selection: '选段',
  extract: '提取',
  ocr: '识别',
  annotation_resurface: '批注回顾',
  memory_organize: '记忆整理',
  conversation: '对话栏',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: '排队',
  running: '进行中',
  done: '完成',
  failed: '失败',
};

const USAGE_TYPE_LABELS: Record<string, string> = {
  digest: '消化',
  chat: '对话',
  weekly_report: '周报',
  evolve: '进化',
  topic: '主题',
  selection: '选段',
  extract: '提取',
  ocr: '识别',
  embed: '向量',
  rerank: '精排',
  memory_organize: '记忆整理',
  conversation: '对话栏',
};

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

const EMPTY_COUNTS: JobQueueCounts = { running: 0, pending: 0, doneToday: 0, failed: 0 };

const JOBS_SYNC_VIEW: SyncView = {
  documents: [],
  openDocumentId: null,
  listIncludesHead: false,
  editor: null,
  topics: [],
  openTopicId: null,
  mapTopicId: null,
  reviewInSession: false,
  jobs: [],
  activeJobId: null,
};

/** History cell: summary minus the `类型 · ` prefix and wrapping 「」. */
export function jobContent(summary: string): string {
  const sep = ' · ';
  const split = summary.indexOf(sep);
  let rest = split > 0 ? summary.slice(split + sep.length) : summary;
  if (rest.startsWith('「') && rest.endsWith('」') && rest.length >= 2) {
    rest = rest.slice(1, -1);
  }
  return rest;
}

export function formatElapsedSec(sec: number): string {
  return `${String(Math.max(0, Math.floor(sec)))}s`;
}

export function formatQueueWhen(
  runAtIso: string,
  now = new Date(),
): { primary: string; secondary: string } {
  const runAt = new Date(runAtIso);
  if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= now.getTime()) {
    return { primary: '立即', secondary: '等前面完成' };
  }
  return {
    primary: `${String(runAt.getMonth() + 1)}月${String(runAt.getDate())}日 ${formatTimeHm(runAt)}`,
    secondary: '定时',
  };
}

export function formatJobTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hm = formatTimeHm(date);
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return hm;
  }
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${hm}`;
}

export function jobDurationMs(job: Job, now = Date.now()): number | null {
  const start = new Date(job.createdAt).getTime();
  if (Number.isNaN(start)) return null;
  if (job.finishedAt) {
    const finished = new Date(job.finishedAt).getTime();
    if (Number.isNaN(finished)) return null;
    return Math.max(0, finished - start);
  }
  if (job.status === 'running') return Math.max(0, now - start);
  return null;
}

export function weekdayShort(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return WEEKDAY_SHORT[date.getDay()] ?? '';
}

export function isLocalDateToday(dateKey: string, now = new Date()): boolean {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return dateKey === `${String(y)}-${m}-${d}`;
}

export function usageTypeLabel(type: string): string {
  return USAGE_TYPE_LABELS[type] ?? type;
}

export function usageSwatch(type: string): string {
  if (type === 'digest') return 'var(--accent)';
  if (type === 'chat') return 'var(--gold)';
  if (type === 'embed' || type === 'rerank') return 'var(--ink-3)';
  return 'var(--green)';
}

export function barHeightPct(tokens: number, max: number): number {
  if (max <= 0 || tokens <= 0) return 0;
  return Math.max(4, Math.round((tokens / max) * 100));
}

export function parseJobStatus(raw: string | null | undefined): JobStatus | '' {
  if (raw && (JOB_STATUSES as readonly string[]).includes(raw)) return raw as JobStatus;
  return '';
}

export function parseJobType(raw: string | null | undefined): JobType | '' {
  if (raw && (JOB_TYPES as readonly string[]).includes(raw)) return raw as JobType;
  return '';
}

export class JobsService extends Service {
  queue: JobQueue | null = null;
  usage: JobUsage | null = null;
  error: string | null = null;

  jobStatus: JobStatus | '' = '';
  jobType: JobType | '' = '';
  jobs: Job[] = [];
  jobsTotal = 0;
  jobsPage = 1;
  jobsLimit = HISTORY_LIMIT;
  /** 大盘「最近动态」：不受历史筛选项影响。 */
  recentJobs: Job[] = [];
  /** 失败待处理区（首屏主角）：最近几条失败 job。 */
  failedJobs: Job[] = [];
  failedTotal = 0;
  retryingId: string | null = null;
  cancellingId: string | null = null;
  /** Job whose execution drill-down is expanded; empty array = 加载中. */
  executionsJobId: string | null = null;
  executions: AgentExecution[] = [];
  executionsLoaded = false;
  /** Job opened from `?job=`, so a memory revision can show its execution. */
  focusedJobId: string | null = null;
  focusedJob: Job | null = null;
  focusedMissing = false;
  focusToken = 0;

  pollTimer: ReturnType<typeof setInterval> | null = null;
  tickTimer: ReturnType<typeof setInterval> | null = null;

  private syncService: SyncService;
  private unsubscribeSync: () => void;
  private echoes: EchoStamp[] = [];
  private closed = false;
  private queueTicket = 0;
  private historyTicket = 0;
  private failedTicket = 0;
  private recentTicket = 0;

  constructor() {
    super();
    this.syncService = this.resolve(SyncService);
    this.unsubscribeSync = this.syncService.subscribe((event) => {
      this.onSync(event);
    });
  }

  get counts(): JobQueueCounts {
    return this.queue?.counts ?? EMPTY_COUNTS;
  }

  get running(): Job[] {
    return this.queue?.running ?? [];
  }

  get pending(): Job[] {
    return this.queue?.pending ?? [];
  }

  get hasActivity(): boolean {
    return this.running.length > 0 || this.pending.length > 0;
  }

  get jobsHasPrev(): boolean {
    return this.jobsPage > 1;
  }

  get jobsHasNext(): boolean {
    return this.jobsPage * this.jobsLimit < this.jobsTotal;
  }

  get usageMax(): number {
    if (!this.usage || this.usage.daily.length === 0) return 0;
    return Math.max(0, ...this.usage.daily.map((day) => day.tokens));
  }

  /** 大盘动态：去掉正在进行 / 排队里已经单独展示的条目。 */
  get feedJobs(): Job[] {
    const live = new Set([...this.running, ...this.pending].map((job) => job.id));
    return this.recentJobs.filter((job) => !live.has(job.id));
  }

  async load(): Promise<void> {
    this.error = null;
    await Promise.all([
      this.loadQueue(),
      this.loadUsage(),
      this.loadRecent(),
      this.loadHistory(),
      this.loadFailed(),
    ]);
    this.syncPolling();
  }

  async loadQueue(): Promise<void> {
    const ticket = ++this.queueTicket;
    try {
      const queue = await getJobQueue();
      if (ticket !== this.queueTicket) return;
      this.queue = queue;
      this.syncTick();
    } catch (err) {
      if (ticket !== this.queueTicket) return;
      if (!this.queue) this.error = errorMessage(err, '加载队列失败');
    }
  }

  async loadUsage(): Promise<void> {
    try {
      this.usage = await getJobUsage();
    } catch (err) {
      if (!this.usage) this.error = errorMessage(err, '加载用量失败');
    }
  }

  async loadRecent(): Promise<void> {
    const ticket = ++this.recentTicket;
    try {
      const page = await listJobs({ limit: RECENT_LIMIT, offset: 0 });
      if (ticket !== this.recentTicket) return;
      this.recentJobs = page.items;
    } catch (err) {
      if (ticket !== this.recentTicket) return;
      if (this.recentJobs.length === 0) this.error = errorMessage(err, '加载任务失败');
    }
  }

  async loadHistory(): Promise<void> {
    const ticket = ++this.historyTicket;
    try {
      const page = await listJobs({
        limit: this.jobsLimit,
        offset: (this.jobsPage - 1) * this.jobsLimit,
        ...(this.jobStatus !== '' ? { status: this.jobStatus } : {}),
        ...(this.jobType !== '' ? { type: this.jobType } : {}),
      });
      if (ticket !== this.historyTicket) return;
      this.jobs = page.items;
      this.jobsTotal = page.total;
    } catch (err) {
      if (ticket !== this.historyTicket) return;
      this.error = errorMessage(err, '加载任务失败');
    }
  }

  async loadFailed(): Promise<void> {
    const ticket = ++this.failedTicket;
    try {
      const page = await listJobs({ status: 'failed', limit: FAILED_LIMIT, offset: 0 });
      if (ticket !== this.failedTicket) return;
      this.failedJobs = page.items;
      this.failedTotal = page.total;
    } catch (err) {
      if (ticket !== this.failedTicket) return;
      if (this.failedJobs.length === 0) this.error = errorMessage(err, '加载任务失败');
    }
  }

  setJobStatus(value: JobStatus | ''): void {
    this.applyHistoryFilters(value, this.jobType);
  }

  setJobType(value: JobType | ''): void {
    this.applyHistoryFilters(this.jobStatus, value);
  }

  hydrateHistoryFilters(status: JobStatus | '', type: JobType | ''): void {
    this.jobStatus = status;
    this.jobType = type;
    this.jobsPage = 1;
  }

  applyHistoryFilters(status: JobStatus | '', type: JobType | ''): void {
    if (this.jobStatus === status && this.jobType === type) return;
    this.hydrateHistoryFilters(status, type);
    void this.loadHistory();
  }

  setJobsPage(page: number): void {
    this.jobsPage = Math.max(1, page);
    void this.loadHistory();
  }

  async cancel(id: string): Promise<void> {
    this.cancellingId = id;
    this.error = null;
    try {
      const job = await cancelJob(id);
      await Promise.all([this.loadQueue(), this.loadHistory(), this.loadRecent()]);
      this.noteJobEcho(job);
      this.syncPolling();
    } catch (err) {
      this.error = errorMessage(err, '取消失败');
    } finally {
      this.cancellingId = null;
    }
  }

  async retry(id: string): Promise<void> {
    this.retryingId = id;
    this.error = null;
    try {
      const job = await retryJob(id);
      await Promise.all([this.loadQueue(), this.loadHistory(), this.loadFailed(), this.loadRecent()]);
      this.noteJobEcho(job);
      this.syncPolling();
    } catch (err) {
      this.error = errorMessage(err, '重试失败');
    } finally {
      this.retryingId = null;
    }
  }

  queueSignature(): string {
    const running = this.running.map((job) => job.id).join(',');
    const pending = this.pending.map((job) => job.id).join(',');
    const { running: r, pending: p, doneToday, failed } = this.counts;
    return `${running}|${pending}|${String(r)}:${String(p)}:${String(doneToday)}:${String(failed)}`;
  }

  clearFocusedJob(): void {
    this.focusToken += 1;
    this.focusedJobId = null;
    this.focusedJob = null;
    this.focusedMissing = false;
  }

  async focusJob(jobId: string): Promise<void> {
    if (this.focusedJobId === jobId && (this.focusedJob !== null || this.focusedMissing)) return;
    const token = ++this.focusToken;
    this.focusedJobId = jobId;
    this.focusedJob = null;
    this.focusedMissing = false;
    try {
      const job = await getJob(jobId);
      if (token !== this.focusToken) return;
      this.focusedJob = job;
      await this.openExecutions(jobId);
    } catch (err) {
      if (token !== this.focusToken) return;
      const missing = err instanceof ApiError && err.status === 404;
      this.focusedJob = null;
      this.focusedMissing = missing;
      if (missing) return;
      this.error = errorMessage(err, '这条任务加载失败');
      if (this.jobs.some((job) => job.id === jobId)) {
        await this.openExecutions(jobId);
      }
    }
  }

  async openExecutions(jobId: string): Promise<void> {
    this.executionsJobId = jobId;
    this.executions = [];
    this.executionsLoaded = false;
    try {
      const items = await listJobExecutions(jobId);
      if (this.executionsJobId !== jobId) return;
      this.executions = items;
      this.executionsLoaded = true;
    } catch (err) {
      if (this.executionsJobId !== jobId) return;
      this.executionsJobId = null;
      this.error = errorMessage(err, '加载执行明细失败');
    }
  }

  async toggleExecutions(jobId: string): Promise<void> {
    if (this.executionsJobId === jobId) {
      this.executionsJobId = null;
      this.executions = [];
      this.executionsLoaded = false;
      return;
    }
    await this.openExecutions(jobId);
  }

  async tickQueue(): Promise<void> {
    const prev = this.queueSignature();
    await this.loadQueue();
    if (this.queueSignature() !== prev) {
      await Promise.all([this.loadHistory(), this.loadFailed(), this.loadRecent()]);
    }
    this.syncPolling();
  }

  tickElapsed(): void {
    if (!this.queue || this.queue.running.length === 0) {
      this.stopTick();
      return;
    }
    this.queue = {
      ...this.queue,
      running: this.queue.running.map((job) => ({
        ...job,
        startedElapsedSec: (job.startedElapsedSec ?? 0) + 1,
      })),
    };
  }

  syncPolling(): void {
    if (this.closed) return;
    if (this.hasActivity) this.startPolling();
    else this.stopPolling();
    this.syncTick();
  }

  startPolling(): void {
    if (this.closed || this.pollTimer !== null) return;
    // Handshake may already have finished before this interval would start.
    if (this.syncService.active) return;
    this.pollTimer = setInterval(() => {
      void this.tickQueue();
    }, POLL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  syncTick(): void {
    if (this.closed) return;
    if (this.running.length > 0) this.startTick();
    else this.stopTick();
  }

  startTick(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      this.tickElapsed();
    }, TICK_MS);
  }

  stopTick(): void {
    if (this.tickTimer === null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  override destroy(): void {
    this.closed = true;
    this.unsubscribeSync();
    this.stopPolling();
    this.stopTick();
    super.destroy();
  }

  private onSync(event: SyncEvent): void {
    if (event.type === 'active') {
      if (event.active) this.stopPolling();
      else this.syncPolling();
      return;
    }
    if (event.type === 'reset') {
      void this.reloadAfterGap();
      return;
    }
    void this.applyJobChanges(event.changes);
  }

  private async applyJobChanges(changes: SyncChange[]): Promise<void> {
    if (this.closed) return;
    const kept = this.consumeEchoes(changes);
    const intents = planReloads(coalesceChanges(kept), JOBS_SYNC_VIEW);
    for (const intent of intents) {
      if (this.closed) return;
      if (intent.kind !== 'job') continue;
      await this.tickQueue();
    }
  }

  private async reloadAfterGap(): Promise<void> {
    if (this.closed) return;
    this.error = null;
    this.echoes = [];
    await Promise.all([this.loadQueue(), this.loadHistory(), this.loadFailed(), this.loadRecent()]);
    if (this.closed) return;
    this.syncPolling();
  }

  private consumeEchoes(changes: SyncChange[]): SyncChange[] {
    const kept = stripEchoes(changes, this.echoes);
    if (kept.length === changes.length) return kept;
    const keptSet = new Set(kept);
    for (const change of changes) {
      if (keptSet.has(change)) continue;
      const atMs = Date.parse(change.at);
      const index = this.echoes.findIndex(
        (echo) =>
          echo.scope === change.scope &&
          echo.resourceId === change.resourceId &&
          echo.atMs === atMs,
      );
      if (index >= 0) this.echoes.splice(index, 1);
    }
    return kept;
  }

  // Stamp only after this queue snapshot shows the cancel or retry.
  private noteJobEcho(job: Job): void {
    if (!this.queue) return;
    const atMs = Date.parse(job.updatedAt);
    if (Number.isNaN(atMs)) return;
    const live = [...this.running, ...this.pending].find((row) => row.id === job.id);
    if (job.status === 'pending' || job.status === 'running') {
      if (!live || Date.parse(live.updatedAt) !== atMs) return;
    } else if (live) {
      return;
    }
    const exists = this.echoes.some(
      (echo) => echo.scope === 'job' && echo.resourceId === job.id && echo.atMs === atMs,
    );
    if (exists) return;
    this.echoes.push({ scope: 'job', resourceId: job.id, atMs });
  }
}
