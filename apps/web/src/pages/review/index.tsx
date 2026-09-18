import {
  DEFAULT_REVIEW_SETTINGS,
  IMAGE_EXCERPT_QUOTE,
  type ReviewDailyBucket,
  type ReviewSettings,
  type ReviewStats,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { Check, ChevronDown, ChevronRight, MoreHorizontal, Pause, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ReportsPane } from './reports-pane';
import { weeklyReportsPath, ROUTES } from '@/routes';
import { cardPath } from '@/routes';
import { cloneSettings, ReviewService } from './review.service';
import { ReviewSectionHead } from './section-head';
import { estimateReviewMinutes } from '@/lib/review-eta';

const LEARNING_STEP_OPTIONS = [1, 3, 6, 10] as const;
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

function tenths(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatMult(n: number): string {
  return tenths(n).toFixed(1);
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[parseDateKey(key).getDay()] ?? '';
}

function dayOfMonth(key: string): string {
  return `${String(parseDateKey(key).getDate())}日`;
}

function dayTotal(row: ReviewDailyBucket): number {
  return row.forgot + row.fuzzy + row.remembered;
}

function allowedSteps(steps: number[]): number[] {
  const allowed = new Set<number>(LEARNING_STEP_OPTIONS);
  const next = steps.filter((step) => allowed.has(step)).sort((a, b) => a - b);
  return next.length > 0 ? next : [...DEFAULT_REVIEW_SETTINGS.learningSteps];
}

function normalizeDraft(draft: ReviewSettings): ReviewSettings {
  return {
    dailyReviewLimit: Math.min(100, Math.max(5, Math.round(draft.dailyReviewLimit))),
    dailyNewLimit: Math.min(30, Math.max(0, Math.round(draft.dailyNewLimit))),
    startingEase: Math.min(3, Math.max(1.3, tenths(draft.startingEase))),
    fuzzyScale: Math.min(1.5, Math.max(1, tenths(draft.fuzzyScale))),
    learningSteps: allowedSteps(draft.learningSteps),
  };
}

const ReviewPageContent = observer(function ReviewPageContent() {
  const service = useService(ReviewService);
  const [params] = useSearchParams();
  const reportsActive = params.get('tab') === 'reports';

  useEffect(() => {
    void service.load();
  }, [service]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (service.mode !== 'session' || reportsActive) return;
      if (event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        service.flip();
        return;
      }
      if (event.key === '1') {
        event.preventDefault();
        void service.gradeAnimated('forgot');
        return;
      }
      if (event.key === '2') {
        event.preventDefault();
        void service.gradeAnimated('fuzzy');
        return;
      }
      if (event.key === '3') {
        event.preventDefault();
        void service.gradeAnimated('remembered');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        void service.exitSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [service, reportsActive]);

  return (
    <>
      {reportsActive ? <ReportsPane /> : service.mode === 'session' ? <SessionPane /> : <HubPane />}
      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}
    </>
  );
});

const HubPane = observer(function HubPane() {
  const service = useService(ReviewService);
  const stats = service.stats;
  const streak = stats?.streak.current ?? 0;
  const longest = stats?.streak.longest ?? 0;
  const due = service.dueCount;
  const minutes = estimateReviewMinutes(due);
  const retention = stats?.retention7d ?? null;
  const daily = stats?.daily ?? [];

  return (
    <div className="hub">
      <ReviewSectionHead active="hub" />

      {!service.ready ? <p className="hint">正在加载复习中心…</p> : null}
      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {/* 今日 Hero */}
      <section className="today-hero">
        <div className="today-main">
          <span className="today-kicker">今日复习</span>
          <div className="today-count">
            <b>{due}</b>
            <span>{due > 0 ? '张卡片到期' : '张卡片到期 · 今日已清空'}</span>
          </div>
          {service.backlogCount > 0 ? (
            <div className="today-sub">
              另有 <b>{service.backlogCount}</b> 张积压卡片会顺延到明天
            </div>
          ) : (
            <div className="today-sub">想起来了就翻面，诚实打分，间隔才会准</div>
          )}
          <div className="today-cta">
            <button
              type="button"
              className="btn btn-primary"
              disabled={service.$model.startSession.loading}
              onClick={() => void service.startSession()}
            >
              {service.$model.startSession.loading ? '准备中…' : '开始复习'}
            </button>
            {due > 0 ? <span className="eta">约 {minutes} 分钟</span> : null}
          </div>
        </div>
        <div className="streak-card">
          <div className="streak-top">
            <span className="streak-flame" aria-hidden>
              🔥
            </span>
            <div>
              {streak === 0 ? (
                <div className="streak-num is-zero">今天开始第一天</div>
              ) : (
                <div className="streak-num">
                  {streak} <small>天连续</small>
                </div>
              )}
              <div className="streak-best">最长纪录 {longest} 天</div>
            </div>
          </div>
          {daily.length > 0 ? (
            <div className="streak-week" title="近 7 天打卡">
              {daily.map((row, index) => {
                const cls = [
                  'sw-dot',
                  dayTotal(row) > 0 ? 'is-done' : '',
                  index === daily.length - 1 ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <span className={cls} key={row.date}>
                    {weekdayShort(row.date)}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      {/* 记忆库数据带 */}
      <section className="metric-band">
        <div className="metric">
          <div className="metric-num">
            {stats?.totalCards ?? 0}
            <small> 张</small>
          </div>
          <div className="metric-label">总卡片</div>
        </div>
        <div className="metric">
          <div className="metric-num">
            {stats?.masteredCount ?? 0}
            <small> 张</small>
          </div>
          <div className="metric-label">已掌握 · 间隔 ≥ 21 天</div>
        </div>
        <div className="metric">
          <div className="metric-num">
            {retention == null ? (
              '—'
            ) : (
              <>
                {retention}
                <small>%</small>
              </>
            )}
          </div>
          <div className="metric-label">近 7 天想起率</div>
        </div>
        <div className="metric">
          <div className="metric-num">
            {stats?.reviews7d ?? 0}
            <small> 次</small>
          </div>
          <div className="metric-label">近 7 天复习</div>
        </div>
      </section>

      <RhythmPanel stats={stats} />

      {/* 最需要巩固 */}
      <section className="hub-panel">
        <div className="hub-panel-head">
          <span className="hub-panel-title">最需要巩固</span>
          <span className="hub-panel-sub">近 30 天里忘记或模糊最多的卡片</span>
        </div>
        {service.struggling.length === 0 ? (
          <p className="hint">还没有明显卡壳的卡片，继续保持。</p>
        ) : (
          <div className="weak-list">
            {service.struggling.map((card) => {
              const heat = Math.min(3, card.forgotCount + card.fuzzyCount);
              return (
                <Link className="weak-row" key={card.id} to={cardPath(card.id, card.documentId)}>
                  <span className="weak-heat" aria-hidden>
                    {[0, 1, 2].map((dot) => (
                      <i className={dot < heat ? 'is-on' : ''} key={dot} />
                    ))}
                  </span>
                  <span className="weak-concept">{card.concept}</span>
                  <span className="weak-meta">
                    {card.forgotCount > 0 ? `忘了 ${String(card.forgotCount)} 次` : null}
                    {card.forgotCount > 0 && card.fuzzyCount > 0 ? ' · ' : null}
                    {card.fuzzyCount > 0 ? `模糊 ${String(card.fuzzyCount)} 次` : null}
                  </span>
                  <ChevronRight className="weak-arrow" width={14} height={14} strokeWidth={2} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <SettingsPanel />
    </div>
  );
});

/** 复习节奏：过去 6 天结果 + 今天 + 未来 6 天预报，一条时间线。 */
function RhythmPanel({ stats }: { stats: ReviewStats | null }) {
  const daily = stats?.daily ?? [];
  const forecast = stats?.forecast ?? [];
  if (daily.length === 0 && forecast.length === 0) {
    return (
      <section className="hub-panel">
        <div className="hub-panel-head">
          <span className="hub-panel-title">复习节奏</span>
          <span className="hub-panel-sub">左边是刷过的，右边是排队的</span>
        </div>
        <p className="hint">还没有复习记录，刷几天这里就热闹了。</p>
      </section>
    );
  }
  const past = daily.slice(0, -1);
  const todayBucket = forecast[0] ?? null;
  const future = forecast.slice(1);
  const max = Math.max(1, ...past.map(dayTotal), ...forecast.map((row) => row.count));

  return (
    <section className="hub-panel">
      <div className="hub-panel-head">
        <span className="hub-panel-title">复习节奏</span>
        <span className="hub-panel-sub">左边是刷过的，右边是排队的</span>
      </div>
      <div className="rhythm">
        {past.map((row) => {
          const total = dayTotal(row);
          const height = (total / max) * 100;
          return (
            <div className="rh-col" key={row.date}>
              <div className="rh-stack" style={{ height: `${String(height)}%` }}>
                {row.remembered > 0 ? (
                  <i className="rh-good" style={{ height: `${String((row.remembered / total) * 100)}%` }} />
                ) : null}
                {row.fuzzy > 0 ? (
                  <i className="rh-hazy" style={{ height: `${String((row.fuzzy / total) * 100)}%` }} />
                ) : null}
                {row.forgot > 0 ? (
                  <i className="rh-bad" style={{ height: `${String((row.forgot / total) * 100)}%` }} />
                ) : null}
              </div>
              <span className="rh-day">{dayOfMonth(row.date)}</span>
            </div>
          );
        })}
        {todayBucket ? (
          <div className="rh-col is-today" key={todayBucket.date}>
            <div className="rh-future" style={{ height: `${String(Math.max(4, (todayBucket.count / max) * 100))}%` }}>
              {todayBucket.count > 0 ? <b>{todayBucket.count}</b> : null}
            </div>
            <span className="rh-day">今天</span>
          </div>
        ) : null}
        {future.map((row) => (
          <div className="rh-col is-future" key={row.date}>
            <div className="rh-future" style={{ height: `${String(Math.max(4, (row.count / max) * 100))}%` }}>
              {row.count > 0 ? <b>{row.count}</b> : null}
            </div>
            <span className="rh-day">{dayOfMonth(row.date)}</span>
          </div>
        ))}
      </div>
      <div className="rhythm-legend">
        <span>
          <span className="sw" style={{ background: 'var(--green)' }} />
          想起来了
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--gold)' }} />
          模糊
        </span>
        <span>
          <span className="sw" style={{ background: '#d0765a' }} />
          忘了
        </span>
        <span>
          <span className="sw sw-future" />
          到期卡片
        </span>
        <span className="hint">今天之后的柱子是虚线 —— 还没发生</span>
      </div>
    </section>
  );
}

const SettingsPanel = observer(function SettingsPanel() {
  const service = useService(ReviewService);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReviewSettings>(() =>
    normalizeDraft(cloneSettings(service.settings)),
  );

  useEffect(() => {
    setDraft(normalizeDraft(cloneSettings(service.settings)));
  }, [service.settings]);

  const patch = (partial: Partial<ReviewSettings>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const toggleStep = (step: number) => {
    setDraft((prev) => {
      const has = prev.learningSteps.includes(step);
      if (has && prev.learningSteps.length <= 1) return prev;
      const next = has
        ? prev.learningSteps.filter((item) => item !== step)
        : [...prev.learningSteps, step].sort((a, b) => a - b);
      return { ...prev, learningSteps: next };
    });
  };

  const saving = service.$model.saveSettings.loading;
  const restoring = service.$model.restoreDefaults.loading;

  return (
    <div className={open ? 'hub-panel is-open' : 'hub-panel'}>
      <div
        className="cfg-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <span className="hub-panel-title">复习设置</span>
        <span className="hub-panel-sub">记忆算法（SM-2）参数，默认适合大多数人</span>
        <ChevronDown className="arrow" width={14} height={14} strokeWidth={2.2} />
      </div>
      <div className="cfg-body">
        <div className="cfg-grid">
          <div className="cfg-item">
            <label>
              每日复习上限 <span className="val">{draft.dailyReviewLimit} 张</span>
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={1}
              value={draft.dailyReviewLimit}
              onChange={(event) => patch({ dailyReviewLimit: Number(event.target.value) })}
            />
            <div className="desc">超过的到期卡会顺延到明天</div>
          </div>
          <div className="cfg-item">
            <label>
              每日新卡上限 <span className="val">{draft.dailyNewLimit} 张</span>
            </label>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={draft.dailyNewLimit}
              onChange={(event) => patch({ dailyNewLimit: Number(event.target.value) })}
            />
            <div className="desc">从没刷过的卡，每天最多混入多少</div>
          </div>
          <div className="cfg-item">
            <label>
              起始难度（ease）<span className="val">{formatMult(draft.startingEase)}×</span>
            </label>
            <input
              type="range"
              min={13}
              max={30}
              step={1}
              value={Math.round(draft.startingEase * 10)}
              onChange={(event) => patch({ startingEase: Number(event.target.value) / 10 })}
            />
            <div className="desc">越大间隔涨得越快，别轻易调高</div>
          </div>
          <div className="cfg-item">
            <label>
              &quot;模糊&quot;的后果 <span className="val">间隔 ×{formatMult(draft.fuzzyScale)}</span>
            </label>
            <input
              type="range"
              min={10}
              max={15}
              step={1}
              value={Math.round(draft.fuzzyScale * 10)}
              onChange={(event) => patch({ fuzzyScale: Number(event.target.value) / 10 })}
            />
            <div className="desc">往左更严格（接近重来），往右更宽松</div>
          </div>
          <div className="cfg-item" style={{ gridColumn: '1 / -1' }}>
            <label>学习步长</label>
            <div className="cfg-steps">
              {LEARNING_STEP_OPTIONS.map((step) => {
                const on = draft.learningSteps.includes(step);
                return (
                  <button
                    key={step}
                    type="button"
                    className={on ? 'cfg-step is-on' : 'cfg-step'}
                    onClick={() => toggleStep(step)}
                  >
                    {step} 天
                  </button>
                );
              })}
            </div>
            <div className="desc">新卡连续答对时，间隔按这个阶梯走，之后按 ease 倍增</div>
          </div>
        </div>
        <div className="cfg-foot">
          <span className="cfg-note">改动只影响之后的调度，不会重排已有卡片</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving || restoring}
            onClick={() => {
              void service.restoreDefaults().then((saved) => {
                if (saved) setDraft(normalizeDraft(saved));
              });
            }}
          >
            {restoring ? '恢复中…' : '恢复默认'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || restoring}
            onClick={() => {
              void service.saveSettings(normalizeDraft(draft));
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
});

const SessionPane = observer(function SessionPane() {
  const service = useService(ReviewService);
  const current = service.current;
  const complete = current == null;
  const grading = service.grading;
  const ease = current?.reviewState.ease ?? service.settings.startingEase;
  const fuzzyScale = service.settings.fuzzyScale;
  const imageUrl = service.currentImageUrl;
  const showQuestion = (service.question.trim() || '') !== IMAGE_EXCERPT_QUOTE;
  const sourceHref =
    current?.card.documentId != null
      ? cardPath(current.card.id, current.card.documentId)
      : null;
  const left = service.items.length;
  const deckClass = ['deck', left === 2 ? 'last-two' : '', left === 1 ? 'last-one' : '']
    .filter(Boolean)
    .join(' ');
  const flying = service.flyDir !== null && service.flyCardId === current?.card.id;
  const wrapClass = ['flip-wrap', flying ? `fly-${service.flyDir ?? 'right'}` : '']
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!current?.card.hasImage) return;
    void service.loadCardImage(current.card.id);
  }, [current?.card.id, current?.card.hasImage, service]);

  useEffect(() => {
    if (!service.cardMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.topic-more-wrap')) {
        service.closeCardMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') service.closeCardMenu();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [service.cardMenuOpen, service]);

  return (
    <div className="review-stage">
      <div className="stage-top">
        <button
          type="button"
          className="stage-exit"
          title="结束复习（Esc）"
          aria-label="结束复习"
          onClick={() => void service.exitSession()}
        >
          <X width={15} height={15} strokeWidth={2} />
        </button>
        <div
          className="segs"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={service.total}
          aria-valuenow={service.cardOrdinal}
          aria-label="今日进度"
        >
          {Array.from({ length: service.total }, (_, index) => {
            const cls =
              index < service.reviewedToday
                ? 'seg is-done'
                : index === service.reviewedToday && current
                  ? 'seg is-now'
                  : 'seg';
            return (
              <div className={cls} key={index}>
                <i />
              </div>
            );
          })}
        </div>
        <span className="stage-count">
          {service.cardOrdinal} / {service.total}
        </span>
        {current ? (
          <div className="topic-more-wrap">
            <button
              type="button"
              className="stage-menu"
              aria-label="卡片操作"
              aria-haspopup="menu"
              aria-expanded={service.cardMenuOpen}
              onClick={() => service.toggleCardMenu()}
            >
              <MoreHorizontal width={16} height={16} strokeWidth={1.8} />
            </button>
            {service.cardMenuOpen ? (
              <div className="topic-menu topic-more-menu" role="menu" aria-label="卡片操作">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void service.markCurrentFamiliar()}
                >
                  <Pause width={13} height={13} strokeWidth={1.8} />
                  已熟悉，不复习
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => void service.removeCurrentCard()}
                >
                  <Trash2 width={13} height={13} strokeWidth={1.8} />
                  删除（移入回收站）
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {complete || !current ? (
        <DoneState />
      ) : (
        <>
          <div className="deck-zone">
            <div className={deckClass}>
              <div className="deck-under d2" aria-hidden />
              <div className="deck-under d1" aria-hidden />
              <div className={wrapClass} key={current.card.id}>
                <div
                  className={service.flipped ? 'flip-card is-flipped' : 'flip-card'}
                  onClick={() => service.flip()}
                >
                  <div className="flip-face flip-front">
                    <div className="flip-crumb">
                      <span className="path">{service.crumb ?? ''}</span>
                      {sourceHref ? (
                        <Link
                          className="src"
                          to={sourceHref}
                          onClick={(event) => event.stopPropagation()}
                        >
                          原文
                        </Link>
                      ) : null}
                    </div>
                    {imageUrl ? (
                      <img
                        className="card-excerpt card-excerpt-review"
                        src={imageUrl}
                        alt=""
                        onError={() => service.retryCardImage(current.card.id)}
                      />
                    ) : null}
                    {showQuestion ? <div className="flip-q">{service.question}</div> : null}
                    <div className="flip-tip">点击卡片或按空格翻面</div>
                    <span className="flip-mark" aria-hidden>
                      问
                    </span>
                  </div>
                  <div className="flip-face flip-back">
                    <span className="flip-kicker">答案</span>
                    <div className="flip-a">{service.answer}</div>
                    <div className="flip-tip">想起来了吗？诚实打分，间隔才会准</div>
                    <span className="flip-mark" aria-hidden>
                      答
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className={service.flipped ? 'grade-row is-show' : 'grade-row'}>
              <GradeButton
                kind="again"
                label="忘了"
                hint="明天再见"
                active={service.lastFeedback === 'forgot' && grading}
                disabled={grading || flying || !service.flipped}
                onPick={() => void service.gradeAnimated('forgot')}
              />
              <GradeButton
                kind="hazy"
                label="模糊"
                hint={`间隔 ×${formatMult(fuzzyScale)}`}
                active={service.lastFeedback === 'fuzzy' && grading}
                disabled={grading || flying || !service.flipped}
                onPick={() => void service.gradeAnimated('fuzzy')}
              />
              <GradeButton
                kind="good"
                label="想起来了"
                hint={`间隔 ×${formatMult(ease)}`}
                active={service.lastFeedback === 'remembered' && grading}
                disabled={grading || flying || !service.flipped}
                onPick={() => void service.gradeAnimated('remembered')}
              />
            </div>
          </div>

          <div className="stage-foot">
            <span>
              <span className="kbd">空格</span>翻面
            </span>
            <span className="sep">·</span>
            <span>
              <span className="kbd">1</span>忘了
            </span>
            <span>
              <span className="kbd">2</span>模糊
            </span>
            <span>
              <span className="kbd">3</span>想起来了
            </span>
            <span className="sep">·</span>
            <span>
              <span className="kbd">Esc</span>结束
            </span>
          </div>
        </>
      )}
    </div>
  );
});

const DoneState = observer(function DoneState() {
  const service = useService(ReviewService);
  const recap = service.sessionRecap;
  const recapTotal = recap.remembered + recap.fuzzy + recap.forgot;
  return (
    <div className="review-done">
      <div className="done-seal" aria-hidden>
        <Check width={32} height={32} strokeWidth={2.2} />
      </div>
      <h2>{service.reviewedToday > 0 ? '今天刷完了' : '今天没有到期的卡片'}</h2>
      <p className="done-sub">
        {recapTotal > 0 ? `${String(recapTotal)} 张卡片 · ` : ''}明天到期 <b>{service.tomorrowDue}</b> 张
      </p>
      {recapTotal > 0 ? (
        <div className="done-recap">
          <span className="done-chip">
            <span className="dot" style={{ background: 'var(--green)' }} />
            想起来了 {recap.remembered}
          </span>
          <span className="done-chip">
            <span className="dot" style={{ background: 'var(--gold)' }} />
            模糊 {recap.fuzzy}
          </span>
          <span className="done-chip">
            <span className="dot" style={{ background: '#d0765a' }} />
            忘了 {recap.forgot}
          </span>
        </div>
      ) : null}
      <div className="done-cta">
        <button type="button" className="btn btn-primary" onClick={() => void service.exitSession()}>
          返回复习中心
        </button>
      </div>
    </div>
  );
});

function GradeButton({
  kind,
  label,
  hint,
  active,
  disabled,
  onPick,
}: {
  kind: 'again' | 'hazy' | 'good';
  label: string;
  hint: string;
  active: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const className = ['grade', `grade-${kind}`, active ? 'is-on' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={className} disabled={disabled} onClick={onPick}>
      <b>{label}</b>
      <span>{hint}</span>
    </button>
  );
}

export const ReviewPage = bindServices(ReviewPageContent, [ReviewService]);
