import { bindServices, observer, useService } from '@rabjs/react';
import type { Job, JobStatus, JobType } from '@inwit/dto';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  MessageCircle,
  ScanText,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { PageHead } from '@/components/page-head';
import { Tag } from '@/components/tag';
import { formatDuration, formatTokens } from '@/lib/format';
import {
  barHeightPct,
  formatElapsedSec,
  formatJobTime,
  formatQueueWhen,
  isLocalDateToday,
  jobContent,
  jobDurationMs,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  JobsService,
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
};

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

const QueueStrip = observer(function QueueStrip() {
  const service = useService(JobsService);
  const counts = service.counts;
  return (
    <div className="queue-strip">
      <div className={`q-stat${counts.running > 0 ? ' is-live' : ''}`}>
        <div className="q-stat-num">
          {counts.running > 0 ? <span className="pulse" /> : null}
          {counts.running}
        </div>
        <div className="q-stat-label">正在进行</div>
      </div>
      <div className="q-stat">
        <div className="q-stat-num">{counts.pending}</div>
        <div className="q-stat-label">排队中</div>
      </div>
      <div className="q-stat">
        <div className="q-stat-num">{counts.doneToday}</div>
        <div className="q-stat-label">今日完成</div>
      </div>
      <div className={`q-stat${counts.failed > 0 ? ' is-bad' : ''}`}>
        <div className="q-stat-num">{counts.failed}</div>
        <div className="q-stat-label">失败待处理</div>
      </div>
    </div>
  );
});

const RunningList = observer(function RunningList() {
  const service = useService(JobsService);
  if (service.running.length === 0) return null;
  return (
    <>
      <div className="jobs-sec">
        正在进行
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

const UsagePanel = observer(function UsagePanel() {
  const service = useService(JobsService);
  const usage = service.usage;
  const max = service.usageMax;
  return (
    <>
      <div className="jobs-sec">
        Token 用量 · 近 7 天
        <span className="line" />
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
    </>
  );
});

function HistoryRow({
  job,
  busy,
  onRetry,
}: {
  job: Job;
  busy: boolean;
  onRetry: () => void;
}) {
  const duration = formatDuration(jobDurationMs(job));
  const time = formatJobTime(job.finishedAt ?? job.createdAt);
  return (
    <tr className={job.status === 'failed' ? 'is-err' : undefined}>
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
      <td className="hist-model">{job.modelNames?.join('、') || '—'}</td>
      <td>{time}</td>
      <td>
        {duration}
        {job.status === 'failed' && job.lastError ? (
          <div className="err-detail">{job.lastError}</div>
        ) : null}
      </td>
      <td>
        {job.status === 'failed' ? (
          <button type="button" className="retry" disabled={busy} onClick={onRetry}>
            {busy ? '重试中…' : '重试'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

const HistoryBoard = observer(function HistoryBoard() {
  const service = useService(JobsService);
  const loading = service.$model.loadHistory.loading && service.jobs.length === 0;
  return (
    <>
      <div className="jobs-sec">
        执行历史
        <span className="line" />
        <div className="hist-filters">
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
      </div>
      <div className="hist">
        {loading ? <p className="empty compact">读取任务…</p> : null}
        {!loading && service.jobs.length === 0 ? (
          <p className="empty compact">还没有任务。扔进文档后，消化记录会出现在这里。</p>
        ) : null}
        {service.jobs.length > 0 ? (
          <table className="hist-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>内容</th>
                <th>状态</th>
                <th>模型</th>
                <th>时间</th>
                <th>耗时</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {service.jobs.map((job) => (
                <HistoryRow
                  key={job.id}
                  job={job}
                  busy={service.retryingId === job.id}
                  onRetry={() => void service.retry(job.id)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
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
      </div>
    </>
  );
});

const JobsPageContent = observer(function JobsPageContent() {
  const service = useService(JobsService);

  useEffect(() => {
    void service.load();
    return () => {
      service.stopPolling();
      service.stopTick();
    };
  }, [service]);

  return (
    <div className="jobs-col">
      <PageHead title="任务与用量" lede="Agent 系统此刻在做什么，一目了然。" />
      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}
      <QueueStrip />
      <RunningList />
      <PendingList />
      <UsagePanel />
      <HistoryBoard />
    </div>
  );
});

export const JobsPage = bindServices(JobsPageContent, [JobsService]);
