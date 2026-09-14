import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import type {
  AdminExecutionDetail,
  AdminExecutionListItem,
  AgentExecutionStatus,
  AgentType,
  Job,
  JobStatus,
  JobType,
} from '@inwit/dto';
import { formatCost, formatDateTime, formatDuration, formatTokens } from '@/lib/format';
import {
  AGENT_TYPE_LABELS,
  AdminService,
  CAPABILITY_LABELS,
  EXEC_STATUS_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  jobDurationMs,
  type AdminTab,
} from './admin.service';
import { TokenTrend } from './trend';

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'jobs', label: '任务队列' },
  { id: 'usage', label: 'Token 用量' },
  { id: 'executions', label: 'Agent 执行' },
];

const JOB_STATUSES: JobStatus[] = ['pending', 'running', 'done', 'failed'];
const JOB_TYPES: JobType[] = ['digest', 'evolve', 'weekly_report', 'topic', 'chat'];
const EXEC_STATUSES: AgentExecutionStatus[] = ['pending', 'running', 'done', 'failed'];
const AGENT_TYPES: AgentType[] = ['digest', 'evolve', 'weekly_report', 'topic', 'chat'];

function StatusPill({ status }: { status: JobStatus | AgentExecutionStatus }) {
  return <span className={`pill ${status}`}>{JOB_STATUS_LABELS[status]}</span>;
}

const JobsBoard = observer(function JobsBoard() {
  const service = useService(AdminService);
  const loading = service.$model.loadJobs.loading && service.jobs.length === 0;

  return (
    <div>
      <div className="filter-row">
        <label>
          状态
          <select
            value={service.jobStatus}
            onChange={(event) => service.setJobStatus(event.target.value as JobStatus | '')}
          >
            <option value="">全部</option>
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>
                {JOB_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select
            value={service.jobType}
            onChange={(event) => service.setJobType(event.target.value as JobType | '')}
          >
            <option value="">全部</option>
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>
                {JOB_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="empty">读取任务…</p> : null}
      {!loading && service.jobs.length === 0 ? (
        <p className="empty">还没有任务。扔进文档后，消化记录会出现在这里。</p>
      ) : null}

      {service.jobs.length > 0 ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>状态</th>
                <th>尝试</th>
                <th>创建时间</th>
                <th>耗时</th>
                <th>错误</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {service.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  busy={service.retryingId === job.id}
                  onRetry={() => void service.retry(job.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pager
        page={service.jobsPage}
        total={service.jobsTotal}
        limit={service.jobsLimit}
        hasPrev={service.jobsHasPrev}
        hasNext={service.jobsHasNext}
        onPrev={() => service.setJobsPage(service.jobsPage - 1)}
        onNext={() => service.setJobsPage(service.jobsPage + 1)}
      />
    </div>
  );
});

const JobRow = observer(function JobRow({
  job,
  busy,
  onRetry,
}: {
  job: Job;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <tr>
      <td>{JOB_TYPE_LABELS[job.type]}</td>
      <td>
        <StatusPill status={job.status} />
      </td>
      <td className="mono">{job.attempts}</td>
      <td>{formatDateTime(job.createdAt)}</td>
      <td>{formatDuration(jobDurationMs(job))}</td>
      <td className="cell-error" title={job.lastError ?? undefined}>
        {job.lastError ?? '—'}
      </td>
      <td>
        {job.status === 'failed' ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={onRetry}>
            {busy ? '重试中…' : '重试'}
          </button>
        ) : null}
      </td>
    </tr>
  );
});

const UsageBoard = observer(function UsageBoard() {
  const service = useService(AdminService);
  const usage = service.usage;
  const loading = service.$model.loadUsage.loading && !usage;

  return (
    <div>
      <div className="filter-row">
        <label>
          窗口
          <select
            value={service.usageDays}
            onChange={(event) => service.setUsageDays(Number(event.target.value))}
          >
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
        </label>
      </div>

      {loading ? <p className="empty">汇总用量…</p> : null}
      {usage ? (
        <>
          <dl className="stat-grid usage-stats">
            <div>
              <dt>总 tokens</dt>
              <dd>{formatTokens(usage.totals.totalTokens)}</dd>
            </div>
            <div>
              <dt>对话</dt>
              <dd>{formatTokens(usage.totals.byCapability.chat.totalTokens)}</dd>
            </div>
            <div>
              <dt>向量</dt>
              <dd>{formatTokens(usage.totals.byCapability.embed.totalTokens)}</dd>
            </div>
            <div>
              <dt>精排</dt>
              <dd>{formatTokens(usage.totals.byCapability.rerank.totalTokens)}</dd>
            </div>
            <div>
              <dt>成本估算</dt>
              <dd>{formatCost(usage.totals.costEstimate)}</dd>
            </div>
          </dl>
          <TokenTrend days={usage.daily} />
          {usage.byModel.length === 0 ? (
            <p className="empty">这段时间还没花 tokens。消化或提问之后会记在这里。</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>供应商</th>
                    <th>模型</th>
                    <th>能力</th>
                    <th>次数</th>
                    <th>tokens</th>
                    <th>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((row) => (
                    <tr key={`${row.provider}:${row.model}:${row.capability}`}>
                      <td>{row.provider}</td>
                      <td className="mono">{row.model}</td>
                      <td>{CAPABILITY_LABELS[row.capability]}</td>
                      <td className="mono">{row.calls}</td>
                      <td className="mono">{formatTokens(row.totalTokens)}</td>
                      <td className="mono">{formatCost(row.costEstimate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
});

const ExecutionsBoard = observer(function ExecutionsBoard() {
  const service = useService(AdminService);
  const loading = service.$model.loadExecutions.loading && service.executions.length === 0;

  return (
    <div>
      <div className="filter-row">
        <label>
          Agent
          <select
            value={service.execAgentType}
            onChange={(event) => service.setExecAgentType(event.target.value as AgentType | '')}
          >
            <option value="">全部</option>
            {AGENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {AGENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            value={service.execStatus}
            onChange={(event) => service.setExecStatus(event.target.value as AgentExecutionStatus | '')}
          >
            <option value="">全部</option>
            {EXEC_STATUSES.map((status) => (
              <option key={status} value={status}>
                {EXEC_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="empty">读取执行记录…</p> : null}
      {!loading && service.executions.length === 0 ? (
        <p className="empty">Agent 还没跑过。消化一篇文档后这里会记下每一步。</p>
      ) : null}

      {service.executions.length > 0 ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>状态</th>
                <th>步数</th>
                <th>耗时</th>
                <th>产出摘要</th>
              </tr>
            </thead>
            <tbody>
              {service.executions.map((item) => (
                <ExecutionBlock key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pager
        page={service.execPage}
        total={service.execTotal}
        limit={service.execLimit}
        hasPrev={service.execHasPrev}
        hasNext={service.execHasNext}
        onPrev={() => service.setExecPage(service.execPage - 1)}
        onNext={() => service.setExecPage(service.execPage + 1)}
      />
    </div>
  );
});

const ExecutionBlock = observer(function ExecutionBlock({ item }: { item: AdminExecutionListItem }) {
  const service = useService(AdminService);
  const open = service.expandedId === item.id;
  const detail = service.details[item.id];

  return (
    <>
      <tr
        className={open ? 'is-open' : undefined}
        tabIndex={0}
        aria-expanded={open}
        onClick={() => void service.toggleExecution(item.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void service.toggleExecution(item.id);
          }
        }}
      >
        <td>{AGENT_TYPE_LABELS[item.agentType]}</td>
        <td>
          <StatusPill status={item.status} />
        </td>
        <td className="mono">{item.stepCount}</td>
        <td>{formatDuration(item.durationMs)}</td>
        <td title={item.resultSummary ?? item.error ?? undefined}>
          {item.resultSummary ?? item.error ?? '—'}
        </td>
      </tr>
      {open ? (
        <tr className="expand-row">
          <td colSpan={5}>
            <ExecutionDetail
              item={item}
              detail={detail}
              loading={service.detailLoadingId === item.id}
              error={service.detailError}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
});

function ExecutionDetail({
  item,
  detail,
  loading,
  error,
}: {
  item: AdminExecutionListItem;
  detail: AdminExecutionDetail | undefined;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !detail) return <p className="empty">读取步骤…</p>;
  if (error && !detail) {
    return (
      <p className="banner-error" role="alert">
        {error}
      </p>
    );
  }
  const steps = detail?.steps ?? [];
  return (
    <div className="exec-detail">
      <p className="meta">
        {item.userEmail}
        {item.documentPreview ? ` · ${item.documentPreview}` : ''}
        {item.jobType ? ` · 任务 ${JOB_TYPE_LABELS[item.jobType]}` : ''}
        {` · ${formatDateTime(item.startedAt)}`}
      </p>
      {steps.length === 0 ? <p className="empty">这一趟没有记下 tool 步骤。</p> : null}
      <ol className="step-timeline">
        {steps.map((step, index) => (
          <li key={`${step.tool}-${String(index)}`}>
            <p className="step-tool">
              <span className="mono">{step.tool}</span>
              <span>{formatDuration(step.duration_ms)}</span>
            </p>
            <p>
              <span className="k">入参</span>
              {step.input_summary || '—'}
            </p>
            <p>
              <span className="k">结果</span>
              {step.output_summary || '—'}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Pager({
  page,
  total,
  limit,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  limit: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="pager">
      <button type="button" className="btn-secondary" disabled={!hasPrev} onClick={onPrev}>
        上一页
      </button>
      <span>
        {from}–{to} / {total}
      </span>
      <button type="button" className="btn-secondary" disabled={!hasNext} onClick={onNext}>
        下一页
      </button>
    </div>
  );
}

const AdminPageContent = observer(function AdminPageContent() {
  const service = useService(AdminService);

  useEffect(() => {
    void service.refresh();
  }, [service]);

  return (
    <section className="page-admin">
      <header className="page-head">
        <h1>任务与用量</h1>
        <p className="lede">任务、用量、执行记录。只看你自己的。</p>
      </header>

      <div className="admin-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={service.tab === tab.id}
            className={service.tab === tab.id ? 'is-on' : undefined}
            onClick={() => service.setTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {service.tab === 'jobs' ? <JobsBoard /> : null}
      {service.tab === 'usage' ? <UsageBoard /> : null}
      {service.tab === 'executions' ? <ExecutionsBoard /> : null}
    </section>
  );
});

export const AdminPage = bindServices(AdminPageContent, [AdminService]);
