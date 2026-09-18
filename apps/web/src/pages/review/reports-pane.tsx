import { docDisplayTitle } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { isBlankPmDoc } from '@/lib/pm-doc';
import { DocView } from '@/components/doc/DocView';
import { ROUTES, weeklyReportsPath } from '@/routes';
import { ReportsService } from './reports.service';
import { ReviewSectionHead } from './section-head';

function periodRange(weekStart: string | null | undefined): string {
  if (!weekStart) return '—';
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return weekStart;
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getMonth() + 1)}.${String(d.getDate())}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

const ReportsContent = observer(function ReportsContent() {
  const service = useService(ReportsService);
  const [params] = useSearchParams();
  const reportId = params.get('report');
  useEffect(() => { void service.load(); }, [service]);
  useEffect(() => { void service.open(reportId); }, [service, reportId]);

  if (reportId) return <ReportDetail />;

  const [latest, ...rest] = service.reports;
  const latestIssue = service.total;

  return (
    <section className="reports">
      <ReviewSectionHead active="reports" lede="回顾每周，找到值得再练一次的概念" />

      {service.error ? (
        <div className="banner-error" role="alert">
          {service.error}{' '}
          <button className="btn" onClick={() => void service.load()}>
            重试
          </button>
        </div>
      ) : null}
      {!service.ready ? (
        <p className="hint" role="status">
          正在加载周报…
        </p>
      ) : null}
      {service.ready && !service.error && service.reports.length === 0 ? (
        <div className="hub-panel rp-empty">
          <h2>第一份周报还在路上</h2>
          <p>本周有复习或新增学习内容后，系统会自动生成学习周报。生成后会保存在这里。</p>
          <Link className="btn btn-primary" to={ROUTES.review}>
            去复习
          </Link>
        </div>
      ) : null}

      {latest ? (
        <Link className="rp-latest" to={weeklyReportsPath(latest.id)}>
          <span className="rp-kicker">本期周报 · 第 {latestIssue} 期</span>
          <div className="rp-period">
            {periodRange(latest.reportWeekStart)}
            <small>学习复盘</small>
          </div>
          {latest.description ? <p className="rp-lede">{latest.description}</p> : null}
          <span className="rp-read">
            阅读周报
            <ArrowRight width={14} height={14} strokeWidth={2.2} />
          </span>
          <span className="rp-seal" aria-hidden>
            报
          </span>
        </Link>
      ) : null}

      {rest.length > 0 ? (
        <div className="rp-archive">
          {rest.map((report, index) => (
            <Link className="rp-row" key={report.id} to={weeklyReportsPath(report.id)}>
              <span className="rp-no">第 {latestIssue - 1 - index} 期</span>
              <span className="rp-row-period">{periodRange(report.reportWeekStart)}</span>
              <span className="rp-row-title">{report.description ?? docDisplayTitle(report)}</span>
              <ChevronRight className="rp-row-arrow" width={14} height={14} strokeWidth={2} />
            </Link>
          ))}
        </div>
      ) : null}

      {service.reports.length < service.total ? (
        <button
          className="btn btn-secondary rp-more"
          disabled={service.$model.loadMore.loading || service.$model.load.loading}
          onClick={() => void service.loadMore()}
        >
          {service.$model.loadMore.loading ? '加载中…' : '更早的周报'}
        </button>
      ) : null}
    </section>
  );
});

const ReportDetail = observer(function ReportDetail() {
  const service = useService(ReportsService);
  const report = service.report;
  const index = report ? service.reports.findIndex((item) => item.id === report.id) : -1;
  const issue = index >= 0 ? service.total - index : null;

  return (
    <section className="rd">
      <div className="rd-top">
        <Link className="rd-back" to={weeklyReportsPath()}>
          <ChevronLeft width={13} height={13} strokeWidth={2.2} />
          全部周报
        </Link>
      </div>

      {service.detailLoading ? (
        <p className="hint" role="status">
          正在加载周报…
        </p>
      ) : null}
      {service.detailError ? (
        <div className="banner-error" role="alert">
          {service.detailError}{' '}
          <button className="btn" onClick={() => void service.retryDetail()}>
            重试
          </button>
        </div>
      ) : null}

      {report ? (
        <>
          <div className="rd-head">
            <span className="rd-kicker">学习周报{issue !== null ? ` · 第 ${String(issue)} 期` : ''}</span>
            <h1 className="rd-title">{docDisplayTitle(report)}</h1>
            <div className="rd-meta">
              {report.reportWeekStart ? `${report.reportWeekStart} 起的一周 · ` : ''}Inwit 自动生成
            </div>
          </div>
          <div className="rd-ornament" aria-hidden>
            ◆
          </div>
          <article className="rd-paper">
            {isBlankPmDoc(report.contentJson) ? (
              <p className="hint">这份历史周报暂无正文。</p>
            ) : (
              <DocView source={report.contentJson} />
            )}
          </article>
          <div className="rd-colophon">INWIT 学习周报 · 每周一自动生成</div>
        </>
      ) : null}
    </section>
  );
});

export const ReportsPane = bindServices(ReportsContent, [ReportsService]);
