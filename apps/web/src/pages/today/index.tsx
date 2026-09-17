import { weeklyReportsPath } from '@/routes';
import {
  agentDocumentMetaLabel,
  docDisplayTitle,
  type DocumentListItem,
  type Job,
  type JobType,
} from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import {
  BookOpen,
  BrainCircuit,
  ChevronDown,
  FileText,
  MessageCircle,
  ScanText,
  StickyNote,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { SearchPalette, SearchService } from '@/components/search';
import { ScreenshotButton } from '@/components/screenshot-button';
import { Tag } from '@/components/tag';
import { dayGreeting, formatRelativeTime, formatTodayLong } from '@/lib/format';
import { CaptureEditor } from '@/components/capture/capture-editor';
import { ROUTES, docPath, topicPath } from '@/routes';
import { TodayService } from './today.service';
import { estimateReviewMinutes } from '@/lib/review-eta';

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
};

function hotkeyGlyph(): string {
  if (typeof navigator === 'undefined') return '⌘';
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';
}

function jobHeadline(job: Job): string {
  if (job.type === 'digest') {
    if (job.status === 'done') return '消化完成';
    if (job.status === 'failed') return '消化失败';
    return '消化中';
  }
  if (job.type === 'chat') {
    if (job.status === 'done') return 'AI 回答';
    if (job.status === 'failed') return '回答失败';
    return '正在回答';
  }
  if (job.type === 'weekly_report') return '周报生成';
  if (job.type === 'selection') {
    if (job.status === 'done') return '选段写卡完成';
    if (job.status === 'failed') return '选段写卡失败';
    return '选段写卡中';
  }
  if (job.type === 'extract') {
    if (job.status === 'done') return '提取完成';
    if (job.status === 'failed') return '提取失败';
    return '提取中';
  }
  if (job.type === 'ocr') {
    if (job.status === 'done') return '识别完成';
    if (job.status === 'failed') return '识别失败';
    return '识别中';
  }
  return '主题进化';
}

function jobDetail(job: Job): string {
  const summary = job.summary.trim();
  const sep = ' · ';
  const split = summary.indexOf(sep);
  if (split > 0) return summary.slice(split + sep.length);
  return summary || job.description;
}

function docTag(doc: DocumentListItem): { tone: 'ai' | 'topic'; label: string } | null {
  const agent = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  if (doc.source === 'screenshot') return { tone: 'topic', label: '截图' };
  if (doc.topicTitle) return { tone: 'topic', label: doc.topicTitle };
  return null;
}

const TodayPageContent = observer(function TodayPageContent() {
  const service = useService(TodayService);
  const search = useService(SearchService);
  const navigate = useNavigate();
  const now = new Date();

  useEffect(() => {
    void service.load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (service.newTopicOpen) {
        service.closeNewTopic();
        return;
      }
      if (search.surfaceOpen) {
        search.closeSurface();
        return;
      }
      if (service.topicMenuOpen) service.closeTopicMenu();
    };
    const onPointer = (event: MouseEvent) => {
      if (!service.topicMenuOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.topic-pick-wrap')) return;
      service.closeTopicMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      service.stopPolling();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [service, search]);

  const topicLabel = service.currentTopic?.title ?? '不指定主题';
  const sending = service.$model.send.loading;
  const askClass = [
    'btn',
    'btn-ghost',
    service.draftLooksLikeQuestion ? 'is-accent' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
    <div className="today-col" inert={search.surfaceOpen || undefined}>
      <div className="today-date">{formatTodayLong(now)}</div>
      <div className="today-head">
        <div className="today-hi">{dayGreeting(now)}</div>
        <button
          type="button"
          className={`today-search-btn${search.surfaceOpen ? ' is-on' : ''}`}
          aria-label="搜索"
          aria-pressed={search.surfaceOpen}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => search.openSurface()}
        >
          <Search strokeWidth={1.8} />
        </button>
      </div>

      <div className="capture hero-capture">
        <CaptureEditor
          placeholder="扔一句话进来，或以问号结尾问 AI…"
          onTextChange={(text) => service.setDraft(text)}
          onSubmit={() => void service.send('auto')}
          onReady={(handle) => service.bindCapture(handle)}
        />
        <div className="capture-bar">
          <div className="topic-pick-wrap">
            <button
              type="button"
              className="topic-pick"
              aria-haspopup="listbox"
              aria-expanded={service.topicMenuOpen}
              onClick={() => service.toggleTopicMenu()}
            >
              <span className={service.topicId ? 'dot' : 'dot is-off'} />
              {topicLabel}
              <ChevronDown width={10} height={10} strokeWidth={2.4} />
            </button>
            {service.topicMenuOpen ? (
              <div className="topic-menu" role="listbox" aria-label="选择主题">
                <button
                  type="button"
                  role="option"
                  aria-selected={service.topicId === null}
                  className={service.topicId === null ? 'is-on' : undefined}
                  onClick={() => service.selectTopic(null)}
                >
                  不指定主题
                </button>
                {service.topics.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    role="option"
                    aria-selected={service.topicId === topic.id}
                    className={service.topicId === topic.id ? 'is-on' : undefined}
                    title={topic.goal ?? topic.title}
                    onClick={() => service.selectTopic(topic.id)}
                  >
                    {topic.title}
                  </button>
                ))}
                <div className="topic-menu-sep" />
                <button type="button" className="topic-menu-new" onClick={() => service.openNewTopic()}>
                  新建主题
                </button>
              </div>
            ) : null}
          </div>
          <div className="capture-hint">
            <span className="kbd">{hotkeyGlyph()}</span>
            <span className="kbd">⏎</span>
            发送
          </div>
          <ScreenshotButton topicId={service.topicId} />
          <button
            type="button"
            className={askClass}
            disabled={!service.canSend}
            onClick={() => void service.send('chat')}
          >
            {sending ? '提问中…' : '问 AI'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!service.canSend}
            onClick={() => void service.send('auto')}
          >
            {sending ? '投入中…' : '扔进去'}
          </button>
        </div>
      </div>

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {service.suggestion ? (
        <div className="banner" role="status">
          <div className="banner-ico" aria-hidden>
            💡
          </div>
          <div className="banner-body">
            <div className="banner-title">可以开个主题</div>
            <div className="banner-sub">
              你最近 {service.suggestion.documentCount} 条资料都关于「{service.suggestion.title}」。
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={service.$model.acceptSuggestion.loading || service.$model.dismissSuggestion.loading}
            onClick={() => {
              void service.acceptSuggestion().then((topic) => {
                if (topic) navigate(topicPath(topic.id));
              });
            }}
          >
            {service.$model.acceptSuggestion.loading ? '开题中…' : '开个主题'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={service.$model.acceptSuggestion.loading || service.$model.dismissSuggestion.loading}
            onClick={() => void service.dismissSuggestion()}
          >
            {service.$model.dismissSuggestion.loading ? '忽略中…' : '忽略'}
          </button>
        </div>
      ) : null}

      {service.resurface ? (
        <div className="banner" role="status">
          <div className="banner-ico" aria-hidden>
            📝
          </div>
          <div className="banner-body">
            <div className="banner-title">批注回顾</div>
            <div className="banner-sub">
              你有 {service.resurface.annotations.length} 条两周前的批注还没消化成卡片
              {service.resurface.annotations[0]?.documentTitle
                ? `，比如《${service.resurface.annotations[0].documentTitle}》里的那条`
                : ''}
              。
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={service.$model.acceptResurface.loading || service.$model.dismissResurface.loading}
            onClick={() => {
              const first = service.resurface?.annotations[0];
              if (first) void service.acceptResurface(first.id);
            }}
          >
            {service.$model.acceptResurface.loading ? '转换中…' : '转成卡片'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={service.$model.acceptResurface.loading || service.$model.dismissResurface.loading}
            onClick={() => void service.dismissResurface()}
          >
            {service.$model.dismissResurface.loading ? '忽略中…' : '忽略'}
          </button>
        </div>
      ) : null}

      <div className="action-grid">
        <Link className="action-card action-review" to={ROUTES.review}>
          <span className="action-kicker">🔥 连续复习 {service.streak} 天</span>
          {service.dueCount > 0 ? (
            <>
              <span className="action-big">
                {service.dueCount}{' '}
                <small>张待复习 · 约 {estimateReviewMinutes(service.dueCount)} 分钟</small>
              </span>
              <span className="action-sub">
                {service.overdueBacklog > 0
                  ? `另有 ${String(service.overdueBacklog)} 张积压会顺延，先刷眼前的`
                  : '现在刷掉，今天的记忆就稳了'}
              </span>
            </>
          ) : (
            <>
              <span className="action-big">今天刷完了</span>
              <span className="action-sub">
                {service.streak > 0 ? `已经连续 ${service.streak} 天` : '今天没有到期的卡片'}
              </span>
            </>
          )}
          <span className="action-go">开始复习 →</span>
        </Link>
        {service.weeklyReport ? (
          <Link className="action-card action-report" to={weeklyReportsPath(service.weeklyReport.documentId)}>
            <span className="action-kicker">📖 本周复盘已生成</span>
            <span className="action-big">
              {service.weeklyReport.successRate}
              <small>% 成功率</small>
            </span>
            <span className="action-sub">
              {service.weeklyReport.relearnCount <= 0
                ? '这周学得很稳'
                : `有 ${String(service.weeklyReport.relearnCount)} 个概念在偷偷遗忘`}
            </span>
            <span className="action-go">去看看 →</span>
          </Link>
        ) : null}
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-num">
            {service.totalCards}
            <small> 张</small>
          </div>
          <div className="stat-label">总卡片</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {service.topics.length}
            <small> 个</small>
          </div>
          <div className="stat-label">主题</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {service.documentTotal}
            <small> 篇</small>
          </div>
          <div className="stat-label">文档</div>
        </div>
      </div>

      <div className="today-sec">
        最近动态
        <Link className="more" to={ROUTES.jobs}>
          全部任务 →
        </Link>
      </div>
      {service.jobs.length === 0 && !service.$model.load.loading ? (
        <p className="hint">还没有任务动态。</p>
      ) : null}
      {service.jobs.map((job) => {
        const Icon = JOB_ICONS[job.type];
        const detail = jobDetail(job);
        return (
          <div className="act" key={job.id}>
            <span className="act-ico">
              <Icon strokeWidth={2} />
            </span>
            <div className="act-body">
              <b>{jobHeadline(job)}</b>
              {detail ? ` · ${detail}` : null}
            </div>
            <span className="act-time">{formatRelativeTime(job.createdAt)}</span>
          </div>
        );
      })}

      <div className="today-sec">
        最近文档
        <Link className="more" to={ROUTES.docs}>
          全部文档 →
        </Link>
      </div>
      {service.recentDocuments.length === 0 && !service.$model.load.loading ? (
        <p className="hint">这张纸还是空的。扔一句话进来。</p>
      ) : null}
      {service.recentDocuments.map((doc) => {
        const tag = docTag(doc);
        return (
          <Link className="recent-row" key={doc.id} to={docPath(doc.id)}>
            <span className="recent-title">{docDisplayTitle(doc)}</span>
            <span className="recent-meta">
              {tag ? <Tag tone={tag.tone}>{tag.label}</Tag> : null}
              {doc.status === 'pending' ? (
                <span className="doc-digesting" aria-busy>
                  <span className="pulse" />
                  消化中
                </span>
              ) : doc.status === 'failed' ? (
                <span className="doc-failed">失败</span>
              ) : (
                <span>
                  {doc.cardCount > 0 ? `${doc.cardCount} 卡 · ` : ''}
                  {formatRelativeTime(doc.updatedAt)}
                </span>
              )}
            </span>
          </Link>
        );
      })}

      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}

      {service.newTopicOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => service.closeNewTopic()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') service.closeNewTopic();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="new-topic-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-topic-title">新建主题</h2>
            <p className="lede">一句话标题，可选学习目标。目标会锚定这个专题里的消化方式。</p>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void service.createNewTopic();
              }}
            >
              <label>
                标题
                <input
                  autoFocus
                  name="title"
                  value={service.newTitle}
                  onChange={(event) => service.setNewTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                目标（可选）
                <textarea
                  name="goal"
                  rows={3}
                  value={service.newGoal}
                  onChange={(event) => service.setNewGoal(event.target.value)}
                  maxLength={4000}
                  placeholder="例如：把 PPO 从直觉讲到能自己推 KL 项"
                />
              </label>
              {service.newTopicError ? (
                <p className="banner-error" role="alert">
                  {service.newTopicError}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button type="button" className="btn btn-ghost" onClick={() => service.closeNewTopic()}>
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={service.$model.createNewTopic.loading}
                >
                  {service.$model.createNewTopic.loading ? '创建中…' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
    <SearchPalette />
    </>
  );
});

export const TodayPage = bindServices(TodayPageContent, [TodayService, SearchService]);
