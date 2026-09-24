import { bindServices, observer, useService } from '@rabjs/react';
import { formatAgentTurn, type AgentExecutionTurn, type Job, type JobStatus, type JobType } from '@inwit/dto';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  MessageCircle,
  Library,
  ScanText,
  StickyNote,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Chip } from '@/components/chip';
import { Tag } from '@/components/tag';
import { formatDuration, formatRelativeTime, formatTokens } from '@/lib/format';
import { jobsPath } from '@/routes';
import {
  barHeightPct,
  formatElapsedSec,
  formatJobTime,
  formatQueueWhen,
  isLocalDateToday,
  jobContent,
  jobDurationMs,
  JOB_STATUS_LABELS,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  JobsService,
  parseJobStatus,
  parseJobType,
  usageSwatch,
  usageTypeLabel,
  weekdayShort,
} from './jobs.service';

const JOB_ICONS: Record<JobType, LucideIcon> = {
  digest: BrainCircuit,
  chat: MessageCircle,
  weekly_report: BookOpen,
  evolve: Sparkles,
  topic: Sparkles,
  selection: Sparkles,
  extract: FileText,
  ocr: ScanText,
  annotation_resurface: StickyNote,
  memory_organize: Library,
};

const STATUS_CHIPS: Array<{ value: JobStatus | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'failed', label: '失败' },
  { value: 'done', label: '完成' },
  { value: 'running', label: '进行中' },
  { value: 'pending', label: '排队' },
];

function JobIcon({ type, size }: { type: JobType; size: 'lg' | 'sm' }) {
  const Icon = JOB_ICONS[type];
  return (
    <span className={`job-ico${size === 'sm' ? ' is-sm' : ''}`}>
      <Icon size={size === 'sm' ? 14 : 17} strokeWidth={1.8} />
    </span>
  );
}

function StatusTag({ status }: { status: JobStatus }) {
  if (status === 'done') return <Tag tone="done">完成</Tag>;
  if (status === 'failed') return <Tag tone="fail">失败</Tag>;
  if (status === 'running') return <Tag tone="busy">进行中</Tag>;
  return <Tag>{JOB_STATUS_LABELS[status]}</Tag>;
}

const ExecutionCard = observer(function ExecutionCard({ models }: { models?: string[] }) {
  const service = useService(JobsService);
  if (!service.executionsLoaded) return <p className="empty compact">读取执行明细…</p>;
  if (service.executions.length === 0) {
    return <p className="empty compact">没有执行记录（该任务早于执行审计，或未经 Agent 执行）。</p>;
  }
  const modelText = models && models.length > 0 ? models.join('、') : null;
  return (
    <div className="exec-card">
      {service.executions.map((execution, index) => {
        const duration = execution.finishedAt
          ? formatDuration(
              new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime(),
            )
          : '进行中';
        return (
          <div className="exec-block" key={execution.id}>
            <div className="exec-head">
              <span className="exec-no">{`第 ${String(index + 1)} 次`}</span>
              <StatusTag status={execution.status} />
              <span>{formatJobTime(execution.startedAt)}</span>
              <span>{duration}</span>
              {modelText ? <span className="exec-model">{modelText}</span> : null}
            </div>
            {execution.resultSummary ? (
              <div className="exec-summary">{execution.resultSummary}</div>
            ) : null}
            {execution.error ? <div className="exec-err">{execution.error}</div> : null}
            {(execution.turns ?? []).length > 0 ? (
              <ul className="exec-turns">
                {(execution.turns ?? []).map((turn) => (
                  <TurnRow key={`${turn.phase}-${String(turn.index)}`} turn={turn} />
                ))}
              </ul>
            ) : null}
            {execution.steps.length > 0 ? (
              <ul className="exec-steps">
                {execution.steps.map((step, stepIndex) => (
                  <li key={stepIndex}>
                    <span className="exec-tool" title={step.input_summary || undefined}>
                      {step.tool}
                    </span>
                    <span className="exec-ms">
                      {`${String(step.duration_ms)}ms`}
                      {step.output_chars != null ? ` · ${String(step.output_chars)}字` : ''}
                    </span>
                    {step.output_summary ? (
                      <span className="exec-io">{step.output_summary}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

function TurnRow({ turn }: { turn: AgentExecutionTurn }) {
  return (
    <li>
      <div>{formatAgentTurn(turn)}</div>
      {turn.text_tail ? <div className="exec-io">{turn.text_tail}</div> : null}
      {turn.reasoning_tail ? <div className="exec-io">{`思考 ${turn.reasoning_tail}`}</div> : null}
    </li>
  );
}

const FailCard = observer(function FailCard({ job }: { job: Job }) {
  const service = useService(JobsService);
  const expanded = service.executionsJobId === job.id;
  const duration = formatDuration(jobDurationMs(job));
  const time = formatJobTime(job.finishedAt ?? job.createdAt);
  return (
    <div className="fail-card">
      <div className="fail-top">
        <JobIcon type={job.type} size="lg" />
        <div className="fail-body">
          <div className="fail-name">
            {jobContent(job.summary)}
            <Tag tone="fail">失败</Tag>
          </div>
          {job.lastError ? <div className="fail-err">{job.lastError}</div> : null}
          <div className="fail-meta">
            <span>{time}</span>
            <span>·</span>
            <span>{duration}</span>
            {job.modelNames && job.modelNames.length > 0 ? (
              <>
                <span>·</span>
                <span>{job.modelNames.join('、')}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="fail-ops">
          <button
            type="button"
            className="retry"
            disabled={service.retryingId === job.id}
            onClick={() => void service.retry(job.id)}
          >
            {service.retryingId === job.id ? '重试中…' : '重试'}
          </button>
          <button
            type="button"
            className="detail-toggle"
            onClick={() => void service.toggleExecutions(job.id)}
          >
            {expanded ? '收起' : '明细'}
          </button>
        </div>
      </div>
      {expanded ? <ExecutionCard models={job.modelNames} /> : null}
    </div>
  );
});

const FailedBoard = observer(function FailedBoard() {
  const service = useService(JobsService);
  const navigate = useNavigate();
  if (service.failedJobs.length === 0) return null;
  const rest = service.failedTotal - service.failedJobs.length;
  return (
    <>
      <div className="jobs-sec">
        {`失败待处理 · ${String(service.failedTotal)}`}
        <span className="line" />
      </div>
      {service.failedJobs.map((job) => (
        <FailCard key={job.id} job={job} />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="detail-toggle"
          onClick={() => navigate(jobsPath({ tab: 'history', status: 'failed' }))}
        >
          {`还有 ${String(rest)} 条，在执行历史中查看全部`}
        </button>
      ) : null}
    </>
  );
});

const RunningList = observer(function RunningList() {
  const service = useService(JobsService);
  if (service.running.length === 0) return null;
  return (
    <>
      <div className="jobs-sec">
        {`正在进行 · ${String(service.running.length)}`}
        <span className="line" />
      </div>
      {service.running.map((job) => (
        <div className="live-job" key={job.id}>
          <div className="job-row">
            <JobIcon type={job.type} size="lg" />
            <div className="job-body">
              <div className="job-name">{job.summary}</div>
              <div className="job-desc">{job.description}</div>
            </div>
            <div className="job-side">
              <div className="job-dur">{formatElapsedSec(job.startedElapsedSec ?? 0)}</div>
              <div className="job-sub">{`第 ${String(Math.max(1, job.attempts))} 次尝试`}</div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
});

const PendingList = observer(function PendingList() {
  const service = useService(JobsService);
  if (service.pending.length === 0) return null;
  const now = new Date();
  return (
    <>
      <div className="jobs-sec">
        {`排队中 · ${String(service.pending.length)}`}
        <span className="line" />
      </div>
      {service.pending.map((job) => {
        const when = formatQueueWhen(job.scheduledFor ?? job.runAt, now);
        return (
          <div className="queue-job" key={job.id}>
            <div className="queue-when">
              <b>{when.primary}</b>
              <span>{when.secondary}</span>
            </div>
            <JobIcon type={job.type} size="sm" />
            <div className="job-body">
              <div className="job-name is-queue">{job.summary}</div>
              <div className="job-desc">{job.description}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.cancellingId === job.id}
              onClick={() => void service.cancel(job.id)}
            >
              {service.cancellingId === job.id ? '取消中…' : '取消'}
            </button>
          </div>
        );
      })}
    </>
  );
});

const HistoryRow = observer(function HistoryRow({
  job,
  busy,
  linked,
  onRetry,
}: {
  job: Job;
  busy: boolean;
  linked?: boolean;
  onRetry: () => void;
}) {
  const service = useService(JobsService);
  const duration = formatDuration(jobDurationMs(job));
  const time = formatJobTime(job.finishedAt ?? job.createdAt);
  const expanded = service.executionsJobId === job.id;
  const rowClass = [job.status === 'failed' ? 'is-err' : '', linked ? 'is-linked' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <tr id={`job-row-${job.id}`} className={rowClass || undefined}>
        <td>
          <span className="hist-type">
            <JobIcon type={job.type} size="sm" />
            {JOB_TYPE_LABELS[job.type]}
          </span>
        </td>
        <td>{jobContent(job.summary)}</td>
        <td>
          <StatusTag status={job.status} />
        </td>
        <td>{time}</td>
        <td>
          {duration}
          {job.status === 'failed' && job.lastError ? (
            <div className="err-detail">{job.lastError}</div>
          ) : null}
        </td>
        <td>
          <div className="hist-ops">
            {job.status === 'failed' ? (
              <button type="button" className="retry" disabled={busy} onClick={onRetry}>
                {busy ? '重试中…' : '重试'}
              </button>
            ) : null}
            <button
              type="button"
              className="detail-toggle"
              onClick={() => void service.toggleExecutions(job.id)}
            >
              {expanded ? '收起' : '明细'}
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="hist-detail-row">
          <td colSpan={6}>
            <ExecutionCard models={job.modelNames} />
          </td>
        </tr>
      ) : null}
    </>
  );
});

const HistoryBoard = observer(function HistoryBoard() {
  const service = useService(JobsService);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const scrolledNode = useRef<Element | null>(null);
  const loading = service.$model.loadHistory.loading && service.jobs.length === 0;
  const focused = service.focusedJob;
  const pinned =
    !loading && focused && !service.jobs.some((job) => job.id === focused.id) ? focused : null;
  const showTable = service.jobs.length > 0 || pinned !== null;
  const go = (status: JobStatus | '', type: JobType | '') => {
    if (status === service.jobStatus && type === service.jobType) return;
    navigate(jobsPath({ tab: 'history', status, type, job: jobId || undefined }));
  };

  useEffect(() => {
    const id = service.focusedJobId;
    if (!id) {
      scrolledNode.current = null;
      return;
    }
    const node = document.getElementById(`job-row-${id}`);
    if (!node || scrolledNode.current === node) return;
    scrolledNode.current = node;
    node.scrollIntoView({ block: 'nearest' });
  }, [service.focusedJobId, service.jobs, service.focusedJob]);

  return (
    <>
      {service.focusedMissing ? <p className="hint">这条任务已经不在了。</p> : null}
      {pinned ? <p className="hint">这条任务不在当前列表里。</p> : null}
      <div className="hist-filters">
        {STATUS_CHIPS.map((chip) => (
          <Chip
            key={chip.value || 'all-status'}
            isOn={service.jobStatus === chip.value}
            onClick={() => go(chip.value, service.jobType)}
          >
            {chip.label}
          </Chip>
        ))}
      </div>
      <div className="hist-filters">
        <Chip isOn={service.jobType === ''} onClick={() => go(service.jobStatus, '')}>
          全部类型
        </Chip>
        {JOB_TYPES.map((type) => (
          <Chip
            key={type}
            isOn={service.jobType === type}
            onClick={() => go(service.jobStatus, type)}
          >
            {JOB_TYPE_LABELS[type]}
          </Chip>
        ))}
      </div>
      <div className="hist">
        {loading ? <p className="empty compact">读取任务…</p> : null}
        {!loading && !showTable && !service.focusedMissing ? (
          <p className="empty compact">还没有任务。扔进文档后，消化记录会出现在这里。</p>
        ) : null}
        {showTable ? (
          <table className="hist-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>内容</th>
                <th>状态</th>
                <th>时间</th>
                <th>耗时</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pinned ? (
                <HistoryRow
                  key={pinned.id}
                  job={pinned}
                  linked
                  busy={service.retryingId === pinned.id}
                  onRetry={() => void service.retry(pinned.id)}
                />
              ) : null}
              {service.jobs.map((job) => (
                <HistoryRow
                  key={job.id}
                  job={job}
                  linked={job.id === service.focusedJobId}
                  busy={service.retryingId === job.id}
                  onRetry={() => void service.retry(job.id)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {service.jobsTotal > 0 ? (
        <div className="hist-pager">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!service.jobsHasPrev}
            onClick={() => service.setJobsPage(service.jobsPage - 1)}
          >
            上一页
          </button>
          <span>
            {String((service.jobsPage - 1) * service.jobsLimit + 1)}–
            {String(Math.min(service.jobsPage * service.jobsLimit, service.jobsTotal))} /{' '}
            {String(service.jobsTotal)}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!service.jobsHasNext}
            onClick={() => service.setJobsPage(service.jobsPage + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </>
  );
});

const UsagePanel = observer(function UsagePanel() {
  const service = useService(JobsService);
  const usage = service.usage;
  const max = service.usageMax;
  return (
    <section className="jobs-usage">
      <div className="jobs-sec">
        近 7 天用量
        <span className="line" />
        {usage ? <span className="jobs-sec-note">{formatTokens(usage.total)}</span> : null}
      </div>
      <div className="usage-panel">
        {!usage ? (
          <p className="empty compact">读取用量…</p>
        ) : (
          <div className="usage-grid">
            <div className="bars">
              {usage.daily.map((day) => (
                <div className="bar-col" key={day.date}>
                  <div
                    className={`bar${isLocalDateToday(day.date) ? '' : ' is-dim'}`}
                    style={{ height: `${String(barHeightPct(day.tokens, max))}%` }}
                  />
                  <span className="bar-day">{weekdayShort(day.date)}</span>
                </div>
              ))}
            </div>
            <div>
              {usage.byType.map((row) => (
                <div className="usage-legend-row" key={row.type}>
                  <span className="sw" style={{ background: usageSwatch(row.type) }} />
                  {usageTypeLabel(row.type)}
                  <span className="v">{formatTokens(row.tokens)}</span>
                </div>
              ))}
              {usage.byType.length === 0 ? (
                <p className="empty compact">这周还没有用量。</p>
              ) : null}
              <div className="usage-legend-row is-total">
                <b>合计</b>
                <span className="v">
                  <b>{formatTokens(usage.total)}</b>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
});

const PulseStrip = observer(function PulseStrip() {
  const service = useService(JobsService);
  const counts = service.counts;
  return (
    <div className="jobs-pulse" aria-label="此刻">
      <div className="jobs-pulse-cell">
        <div className={`jobs-pulse-n${counts.running > 0 ? ' is-live' : ''}`}>{counts.running}</div>
        <div className="jobs-pulse-k">进行中</div>
      </div>
      <div className="jobs-pulse-cell">
        <div className="jobs-pulse-n">{counts.pending}</div>
        <div className="jobs-pulse-k">排队</div>
      </div>
      <div className="jobs-pulse-cell">
        <div className="jobs-pulse-n">{counts.doneToday}</div>
        <div className="jobs-pulse-k">今日完成</div>
      </div>
      <div className="jobs-pulse-cell">
        <div className={`jobs-pulse-n${counts.failed > 0 ? ' is-bad' : ''}`}>{counts.failed}</div>
        <div className="jobs-pulse-k">失败待处理</div>
      </div>
    </div>
  );
});

const RecentFeed = observer(function RecentFeed() {
  const service = useService(JobsService);
  const items = service.feedJobs;
  const loading = service.$model.loadRecent.loading && service.recentJobs.length === 0;
  return (
    <section className="jobs-feed">
      <div className="jobs-sec">
        最近动态
        <span className="line" />
        <Link className="jobs-sec-more" to={jobsPath({ tab: 'history' })}>
          全部
        </Link>
      </div>
      {loading ? <p className="empty compact">读取动态…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="empty compact">还没有任务动态。</p>
      ) : null}
      {items.length > 0 ? (
        <div className="jobs-feed-list">
          {items.map((job) => (
            <div className="jobs-feed-item" key={job.id}>
              <JobIcon type={job.type} size="sm" />
              <div className="jobs-feed-body">
                <b>{JOB_TYPE_LABELS[job.type]}</b>
                {jobContent(job.summary) ? ` · ${jobContent(job.summary)}` : null}
              </div>
              {job.status !== 'done' ? <StatusTag status={job.status} /> : null}
              <span className="jobs-feed-time">
                {formatRelativeTime(job.finishedAt ?? job.createdAt)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
});

const JobsHead = observer(function JobsHead({
  tab,
  jobId,
}: {
  tab: 'board' | 'history';
  jobId?: string | null;
}) {
  const service = useService(JobsService);
  return (
    <div className="jobs-head">
      <h1 className="jobs-title">任务</h1>
      <p className="jobs-lede">
        {tab === 'board'
          ? '此刻在消化什么，近一周用了多少。'
          : '按状态和类型筛。已结束的任务、执行明细和用量保留 30 天。'}
      </p>
      <nav className="jobs-tabs" aria-label="任务栏目">
        <Link
          className={tab === 'board' ? 'jobs-tab is-on' : 'jobs-tab'}
          to={jobsPath()}
          aria-current={tab === 'board' ? 'page' : undefined}
        >
          大盘
        </Link>
        <Link
          className={tab === 'history' ? 'jobs-tab is-on' : 'jobs-tab'}
          to={jobsPath({
            tab: 'history',
            status: service.jobStatus,
            type: service.jobType,
            job: jobId || undefined,
          })}
          aria-current={tab === 'history' ? 'page' : undefined}
        >
          执行历史
        </Link>
      </nav>
    </div>
  );
});

const JobsPageContent = observer(function JobsPageContent() {
  const service = useService(JobsService);
  const [params] = useSearchParams();
  const jobParam = params.get('job');
  const historyActive = params.get('tab') === 'history' || Boolean(jobParam);
  const statusParam = parseJobStatus(params.get('status'));
  const typeParam = parseJobType(params.get('type'));

  // Initial URL only; later tab/filter changes go through applyHistoryFilters.
  useEffect(() => {
    if (historyActive) service.hydrateHistoryFilters(statusParam, typeParam);
    void service.load();
    return () => {
      service.stopPolling();
      service.stopTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load
  }, [service]);

  useEffect(() => {
    if (!historyActive) return;
    service.applyHistoryFilters(statusParam, typeParam);
  }, [historyActive, statusParam, typeParam, service]);

  useEffect(() => {
    if (!jobParam) {
      service.clearFocusedJob();
      return;
    }
    void service.focusJob(jobParam);
    return () => {
      service.clearFocusedJob();
    };
  }, [jobParam, service]);

  return (
    <div className="jobs-col">
      <JobsHead tab={historyActive ? 'history' : 'board'} jobId={jobParam} />
      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}
      {historyActive ? (
        <HistoryBoard />
      ) : (
        <>
          <PulseStrip />
          <div className="jobs-board">
            <div className="jobs-now">
              <FailedBoard />
              <RunningList />
              <PendingList />
              <RecentFeed />
            </div>
            <UsagePanel />
          </div>
        </>
      )}
    </div>
  );
});

export const JobsPage = bindServices(JobsPageContent, [JobsService]);
