import { docDisplayTitle } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { isBlankPmDoc } from '@/lib/pm-doc';
import { DocView } from '@/components/doc/DocView';
import { weeklyReportsPath } from '@/routes';
import { ReportsService } from './reports.service';

const ReportsContent = observer(function ReportsContent() {
  const service = useService(ReportsService);
  const [params] = useSearchParams();
  const reportId = params.get('report');
  useEffect(() => { void service.load(); }, [service]);
  useEffect(() => { void service.open(reportId); }, [service, reportId]);

  if (reportId) return (
    <section className="weekly-reports weekly-report-detail">
      <Link className="weekly-back" to={weeklyReportsPath()}>← 全部周报</Link>
      {service.detailLoading ? <p className="hint" role="status">正在加载周报…</p> : null}
      {service.detailError ? <div className="banner-error" role="alert">{service.detailError} <button className="btn" onClick={() => void service.retryDetail()}>重试</button></div> : null}
      {service.report ? <article>
        <header className="weekly-report-heading">
          <span className="weekly-period">{service.report.reportWeekStart} 起的一周</span>
          <h1>{docDisplayTitle(service.report)}</h1>
        </header>
        <div className="paper">{isBlankPmDoc(service.report.contentJson) ? <p className="hint">这份历史周报暂无正文。</p> : <DocView source={service.report.contentJson} />}</div>
      </article> : null}
    </section>
  );

  return (
    <section className="weekly-reports">
      <header className="weekly-report-heading">
        <h1>学习周报</h1>
        <p>回顾每周的学习进展，找到值得再练一次的概念。</p>
      </header>
      {service.error ? <div className="banner-error" role="alert">{service.error} <button className="btn" onClick={() => void service.load()}>重试</button></div> : null}
      {!service.ready ? <p className="hint" role="status">正在加载周报…</p> : null}
      {service.ready && !service.error && service.reports.length === 0 ? (
        <div className="weekly-empty"><h2>第一份周报还在路上</h2><p>本周有复习或新增学习内容后，系统会自动生成学习周报。生成后会保存在这里。</p><Link className="btn" to="/review">去复习</Link></div>
      ) : null}
      <div className="weekly-report-list">
        {service.reports.map((report, index) => <Link className="weekly-report-row" key={report.id} to={weeklyReportsPath(report.id)}>
          <div><span className="weekly-period">{report.reportWeekStart} 起的一周{index === 0 ? ' · 最新' : ''}</span><h2>{docDisplayTitle(report)}</h2>{report.description ? <p>{report.description}</p> : null}</div>
          <span className="weekly-read">阅读周报 →</span>
        </Link>)}
      </div>
      {service.reports.length < service.total ? <button className="btn weekly-more" disabled={service.$model.loadMore.loading || service.$model.load.loading} onClick={() => void service.loadMore()}>{service.$model.loadMore.loading ? '加载中…' : '更早的周报'}</button> : null}
    </section>
  );
});

export const ReportsPane = bindServices(ReportsContent, [ReportsService]);
