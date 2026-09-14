import { Service } from '@rabjs/react';
import type {
  AdminExecutionDetail,
  AdminExecutionListItem,
  AgentExecutionStatus,
  AgentType,
  Job,
  JobStatus,
  JobType,
  UsageSummary,
} from '@inwit/dto';
import {
  getAdminExecution,
  getUsageSummary,
  listAdminExecutions,
  listAdminJobs,
  retryAdminJob,
} from '@/api/admin';
import { errorMessage } from '@/api/client';

export type AdminTab = 'jobs' | 'usage' | 'executions';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: '等待',
  running: '执行中',
  done: '完成',
  failed: '失败',
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  digest: '消化',
  evolve: '进化',
  weekly_report: '周报',
  topic: '主题',
  chat: '对话',
};

export const AGENT_TYPE_LABELS: Record<AgentType, string> = JOB_TYPE_LABELS;

export const EXEC_STATUS_LABELS: Record<AgentExecutionStatus, string> = JOB_STATUS_LABELS;

export const CAPABILITY_LABELS = {
  chat: '对话',
  embed: '向量',
  rerank: '精排',
} as const;

export function jobDurationMs(job: Job, now = Date.now()): number | null {
  const created = new Date(job.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  if (job.finishedAt) {
    const finished = new Date(job.finishedAt).getTime();
    if (Number.isNaN(finished)) return null;
    return Math.max(0, finished - created);
  }
  if (job.status === 'running') return Math.max(0, now - created);
  return null;
}

export class AdminService extends Service {
  tab: AdminTab = 'jobs';
  error: string | null = null;

  jobStatus: JobStatus | '' = '';
  jobType: JobType | '' = '';
  jobs: Job[] = [];
  jobsTotal = 0;
  jobsPage = 1;
  jobsLimit = 20;
  retryingId: string | null = null;

  usageDays = 30;
  usage: UsageSummary | null = null;

  execAgentType: AgentType | '' = '';
  execStatus: AgentExecutionStatus | '' = '';
  executions: AdminExecutionListItem[] = [];
  execTotal = 0;
  execPage = 1;
  execLimit = 20;
  expandedId: string | null = null;
  details: Record<string, AdminExecutionDetail> = {};
  detailLoadingId: string | null = null;
  detailError: string | null = null;

  get jobsHasPrev(): boolean {
    return this.jobsPage > 1;
  }

  get jobsHasNext(): boolean {
    return this.jobsPage * this.jobsLimit < this.jobsTotal;
  }

  get execHasPrev(): boolean {
    return this.execPage > 1;
  }

  get execHasNext(): boolean {
    return this.execPage * this.execLimit < this.execTotal;
  }

  setTab(tab: AdminTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.error = null;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.tab === 'jobs') {
      await this.loadJobs();
      return;
    }
    if (this.tab === 'usage') {
      await this.loadUsage();
      return;
    }
    await this.loadExecutions();
  }

  async loadJobs(): Promise<void> {
    this.error = null;
    try {
      const page = await listAdminJobs({
        page: this.jobsPage,
        limit: this.jobsLimit,
        ...(this.jobStatus !== '' ? { status: this.jobStatus } : {}),
        ...(this.jobType !== '' ? { type: this.jobType } : {}),
      });
      this.jobs = page.items;
      this.jobsTotal = page.total;
      this.jobsPage = page.page;
    } catch (err) {
      this.error = errorMessage(err, '加载任务失败');
    }
  }

  setJobStatus(value: JobStatus | ''): void {
    this.jobStatus = value;
    this.jobsPage = 1;
    void this.loadJobs();
  }

  setJobType(value: JobType | ''): void {
    this.jobType = value;
    this.jobsPage = 1;
    void this.loadJobs();
  }

  setJobsPage(page: number): void {
    this.jobsPage = Math.max(1, page);
    void this.loadJobs();
  }

  async retry(id: string): Promise<void> {
    this.retryingId = id;
    this.error = null;
    try {
      await retryAdminJob(id);
      await this.loadJobs();
    } catch (err) {
      this.error = errorMessage(err, '重试失败');
    } finally {
      this.retryingId = null;
    }
  }

  async loadUsage(): Promise<void> {
    this.error = null;
    try {
      this.usage = await getUsageSummary(this.usageDays);
    } catch (err) {
      this.error = errorMessage(err, '加载用量失败');
    }
  }

  setUsageDays(days: number): void {
    this.usageDays = days;
    void this.loadUsage();
  }

  async loadExecutions(): Promise<void> {
    this.error = null;
    try {
      const page = await listAdminExecutions({
        page: this.execPage,
        limit: this.execLimit,
        ...(this.execAgentType !== '' ? { agentType: this.execAgentType } : {}),
        ...(this.execStatus !== '' ? { status: this.execStatus } : {}),
      });
      this.executions = page.items;
      this.execTotal = page.total;
      this.execPage = page.page;
    } catch (err) {
      this.error = errorMessage(err, '加载执行记录失败');
    }
  }

  setExecAgentType(value: AgentType | ''): void {
    this.execAgentType = value;
    this.execPage = 1;
    void this.loadExecutions();
  }

  setExecStatus(value: AgentExecutionStatus | ''): void {
    this.execStatus = value;
    this.execPage = 1;
    void this.loadExecutions();
  }

  setExecPage(page: number): void {
    this.execPage = Math.max(1, page);
    void this.loadExecutions();
  }

  async toggleExecution(id: string): Promise<void> {
    if (this.expandedId === id) {
      this.expandedId = null;
      return;
    }
    this.expandedId = id;
    this.detailError = null;
    if (this.details[id]) return;
    this.detailLoadingId = id;
    try {
      const detail = await getAdminExecution(id);
      this.details = { ...this.details, [id]: detail };
    } catch (err) {
      this.detailError = errorMessage(err, '读取执行明细失败');
    } finally {
      if (this.detailLoadingId === id) this.detailLoadingId = null;
    }
  }
}
