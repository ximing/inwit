import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import type { ReviewFeedback } from '@inwit/dto';
import { cardPath, docPath, ROUTES } from '@/routes';
import { ReviewService } from './review.service';

const FEEDBACK: Array<{ id: ReviewFeedback; label: string; hint: string; className: string }> = [
  { id: 'forgot', label: '忘了', hint: '明天再见', className: 'btn-forgot' },
  { id: 'fuzzy', label: '模糊', hint: '隔几天再问', className: 'btn-fuzzy' },
  { id: 'remembered', label: '想起来了', hint: '拉长间隔', className: 'btn-remembered' },
];

const ReviewPageContent = observer(function ReviewPageContent() {
  const service = useService(ReviewService);

  useEffect(() => {
    void service.load();
  }, [service]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      }
      if (event.key === 'Escape' && service.sheetOpen) {
        event.preventDefault();
        service.closeSheet();
        return;
      }
      if (event.code === 'Space') {
        if (target instanceof HTMLElement && target.closest('button, a') && !target.closest('.flashcard')) {
          return;
        }
        event.preventDefault();
        service.flip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [service]);

  if (!service.ready) {
    return (
      <section className="page-review">
        <p className="empty">正在取出今日队列…</p>
      </section>
    );
  }

  const grading = service.$model.grade.loading;

  return (
    <section className="page-review">
      <div
        className="review-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={service.total}
        aria-valuenow={service.reviewedToday}
        aria-label="今日进度"
      >
        <div className="review-progress-bar" style={{ width: `${String(service.progressPct)}%` }} />
      </div>

      <header className="review-head">
        <h1>今日复习</h1>
        <p className="progress">
          已刷 {service.reviewedToday} / {service.total}
        </p>
      </header>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {service.empty ? (
        <div className="review-done">
          <p className="empty">今天没有到期的卡片。</p>
          <p className="lede">
            去<Link to={ROUTES.home}>文档页</Link>扔一点东西进去，明天就会排上队。
          </p>
        </div>
      ) : null}

      {service.done ? (
        <div className="review-done">
          <h2>今天这些都想过一遍了</h2>
          <p className="lede">今日 {service.reviewedToday} 张。先自己想，会记得更久。</p>
          {service.stats ? (
            <dl className="stat-grid">
              <div>
                <dt>近 7 天想起来了</dt>
                <dd>{service.stats.last7Days.remembered}</dd>
              </div>
              <div>
                <dt>模糊</dt>
                <dd>{service.stats.last7Days.fuzzy}</dd>
              </div>
              <div>
                <dt>忘了</dt>
                <dd>{service.stats.last7Days.forgot}</dd>
              </div>
              <div>
                <dt>积压</dt>
                <dd>{service.stats.overdueCount}</dd>
              </div>
            </dl>
          ) : null}
          {service.weeklyReport ? (
            <p className="review-week-link">
              <Link to={docPath(service.weeklyReport.documentId)}>本周复盘 →</Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {service.current ? (
        <>
          {service.relatedCount > 0 || service.mapPlacement ? (
            <div className="review-hints">
              {service.relatedCount > 0 ? (
                <button
                  type="button"
                  className="related-hint"
                  aria-expanded={service.sheetOpen}
                  onClick={() => (service.sheetOpen ? service.closeSheet() : service.openSheet())}
                >
                  关联 {service.relatedCount} 张卡片
                </button>
              ) : null}
              {service.mapPlacement ? (
                <p className="related-hint is-static">
                  {service.mapPlacement.topicTitle} · {service.mapPlacement.nodePath}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flashcard-scene">
            <button
              type="button"
              className={`flashcard${service.flipped ? ' is-flipped' : ''}`}
              aria-pressed={service.flipped}
              onClick={() => service.flip()}
            >
              <span className="flashcard-face flashcard-front" aria-hidden={service.flipped}>
                <span className="flash-kicker">先自己想</span>
                <span className="flash-body">{service.question}</span>
                <span className="flash-hint">点击或空格翻面</span>
              </span>
              <span className="flashcard-face flashcard-back" aria-hidden={!service.flipped}>
                <span className="flash-kicker">答案</span>
                <span className="flash-body">{service.answer}</span>
              </span>
            </button>
          </div>

          {service.flipped ? (
            <div className="feedback">
              {FEEDBACK.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${item.className}${service.lastFeedback === item.id && grading ? ' is-on' : ''}`}
                  disabled={grading}
                  onClick={() => void service.grade(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="lede center">先自己想，想起来了再翻。不要偷看。</p>
          )}
        </>
      ) : null}

      <div
        className={`related-sheet${service.sheetOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-label="关联卡片"
        aria-hidden={!service.sheetOpen}
        inert={!service.sheetOpen || undefined}
      >
        <div className="related-sheet-head">
          <p className="doc-answer-kicker">关联的卡片</p>
          <button type="button" className="btn-ghost" onClick={() => service.closeSheet()}>
            收起
          </button>
        </div>
        {service.relatedGroups.length === 0 ? <p className="lede">这张还没连上别的卡。</p> : null}
        <ul className="related-sheet-list">
          {service.relatedGroups.flatMap((group) =>
            group.items.map((item) => (
              <li key={item.id}>
                <Link to={cardPath(item.card.id)} onClick={() => service.closeSheet()}>
                  <span className="k">{group.label}</span>
                  {item.card.concept}
                </Link>
              </li>
            )),
          )}
        </ul>
      </div>
    </section>
  );
});

export const ReviewPage = bindServices(ReviewPageContent, [ReviewService]);
