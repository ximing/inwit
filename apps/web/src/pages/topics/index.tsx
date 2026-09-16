import { agentDocumentMetaLabel, docDisplayTitle, type DocumentListItem } from '@inwit/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronRight, Tags } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { docSummaryLine } from '@/components/doc-row';
import { ReaderOverlay } from '@/components/reader/ReaderOverlay';
import { ReaderService } from '@/components/reader/reader.service';
import { SearchBox, SearchResults, SearchService } from '@/components/search';
import { Tag } from '@/components/tag';
import { formatRelativeTime, isSubmitHotkey, summarizeAnswer } from '@/lib/format';
import { ROUTES, topicPath } from '@/routes';
import { FeedTab, MapTab, NodeDrawer } from './detail';
import { TopicsService, type TopicListItem } from './topics.service';

const TopicsPageContent = observer(function TopicsPageContent() {
  const service = useService(TopicsService);
  const search = useService(SearchService);
  const reader = useService(ReaderService);
  const [params] = useSearchParams();
  const raw = params.get('topic');
  const topicId = raw && raw.length > 0 ? raw : null;

  useLayoutEffect(() => {
    search.setTopicId(topicId);
  }, [topicId, search]);

  useEffect(() => {
    void service.load();
    return () => {
      service.stopJobPolling();
      service.stopDocPolling();
    };
  }, [service]);

  useEffect(() => {
    void service.openTopic(topicId);
  }, [topicId, service]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (reader.isOpen) return;
      if (service.editing) {
        service.cancelEdit();
        return;
      }
      if (service.newTopicOpen) {
        service.closeNewTopic();
        return;
      }
      if (service.paneMenuOpen) service.closePaneMenu();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (service.paneMenuOpen && !target.closest('.topic-more-wrap')) {
        service.closePaneMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [service, reader]);

  return (
    <div className="ws ws-topics">
      <TopicList selectedId={topicId} />
      <div className={`ws-pane${service.drawerOpen ? ' is-drawer-open' : ''}`}>
        {topicId ? <TopicPane topicId={topicId} /> : <PaneEmpty />}
        <NodeDrawer />
      </div>
      {service.toast ? (
        <p className="toast" role="status">
          {service.toast}
        </p>
      ) : null}
      <ReaderOverlay />
    </div>
  );
});

const TopicList = observer(function TopicList({ selectedId }: { selectedId: string | null }) {
  const service = useService(TopicsService);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (service.newTopicOpen) inputRef.current?.focus();
  }, [service.newTopicOpen]);

  const submitNew = async () => {
    const id = await service.createNewTopic();
    if (id) navigate(topicPath(id));
  };

  return (
    <div className="ws-list">
      <div className="ws-head">
        <button type="button" className="btn ws-new-topic" onClick={() => service.openNewTopic()}>
          ＋ 新建主题
        </button>
      </div>
      {service.error ? (
        <p className="banner-error ws-list-error" role="alert">
          {service.error}
        </p>
      ) : null}
      <div className="ws-scroll">
        {service.newTopicOpen ? (
          <div className="row is-on topic-new-row">
            <input
              ref={inputRef}
              value={service.newTitle}
              maxLength={200}
              placeholder="主题名称，回车创建"
              disabled={service.$model.createNewTopic.loading}
              onChange={(event) => service.setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitNew();
                }
                if (event.key === 'Escape') service.closeNewTopic();
              }}
            />
            {service.newTopicError ? (
              <p className="banner-error" role="alert">
                {service.newTopicError}
              </p>
            ) : null}
          </div>
        ) : null}
        {service.$model.load.loading && service.items.length === 0 ? (
          <p className="empty compact">读取主题…</p>
        ) : null}
        {service.active.length === 0 &&
        !service.$model.load.loading &&
        !service.newTopicOpen &&
        service.archived.length === 0 ? (
          <p className="hint">还没有主题。点上方新建一个。</p>
        ) : null}
        {service.active.map((item) => (
          <TopicRow key={item.topic.id} item={item} selected={item.topic.id === selectedId} />
        ))}
      </div>
      {service.archived.length > 0 ? (
        <div className="ws-archive">
          <button
            type="button"
            className="ws-archive-toggle"
            aria-expanded={service.archiveOpen}
            onClick={() => service.toggleArchiveOpen()}
          >
            {service.archiveOpen ? (
              <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
            ) : (
              <ChevronRight width={14} height={14} strokeWidth={1.8} aria-hidden />
            )}
            {`已归档 · ${String(service.archived.length)}`}
          </button>
          {service.archiveOpen ? (
            <div className="ws-archive-body">
              {service.archived.map((item) => (
                <TopicRow
                  key={item.topic.id}
                  item={item}
                  selected={item.topic.id === selectedId}
                  archived
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function TopicRow({
  item,
  selected,
  archived = false,
}: {
  item: TopicListItem;
  selected: boolean;
  archived?: boolean;
}) {
  const { topic } = item;
  const emptyGoal = !topic.goal || topic.goal.trim().length === 0;
  const pct = item.masteryPct;
  return (
    <Link
      to={topicPath(topic.id)}
      className={`row topic-row${selected ? ' is-on' : ''}${archived ? ' is-archived' : ''}`}
    >
      <div className="row-title">
        <span className="t">{topic.title}</span>
      </div>
      <div className={`row-goal${emptyGoal ? ' is-empty' : ''}`}>
        {emptyGoal ? '一句话锚定这个专题的消化方式' : topic.goal}
      </div>
      <div className="row-meta topic-row-meta">
        <span>{`${String(item.cardCount)} 卡 · ${String(item.documentCount)} 篇文档`}</span>
        <span
          className="topic-mastery"
          role="progressbar"
          aria-label="掌握度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <i style={{ width: `${String(pct)}%` }} />
        </span>
      </div>
    </Link>
  );
}

function PaneEmpty() {
  return (
    <div className="pane-empty">
      <Tags className="pane-empty-ico" strokeWidth={1.4} aria-hidden />
      <p className="pane-empty-title">从左边选一个主题，或新建一个</p>
      <p className="pane-empty-sub">主题不是文件夹。每个主题是一段持续生长的上下文。</p>
    </div>
  );
}

const TopicPane = observer(function TopicPane({ topicId }: { topicId: string }) {
  const service = useService(TopicsService);
  const navigate = useNavigate();
  const topic = service.topic;
  const loading = service.$model.openTopic.loading && !topic;
  const archived = topic?.status === 'archived';

  const remove = async () => {
    if (!window.confirm('删除这个主题？文档会保留，地图会一起删掉。')) return;
    const ok = await service.deleteSelected();
    if (ok) navigate(ROUTES.topics);
  };

  if (loading) {
    return (
      <div className="pane-inner">
        <p className="empty">打开主题…</p>
      </div>
    );
  }

  if (service.detailError && !topic) {
    return (
      <div className="pane-inner">
        <p className="banner-error" role="alert">
          {service.detailError} <Link to={ROUTES.topics}>回主题列表</Link>
        </p>
      </div>
    );
  }

  if (!topic || topic.id !== topicId) {
    return (
      <div className="pane-inner">
        <p className="empty">打开主题…</p>
      </div>
    );
  }

  const emptyGoal = !topic.goal || topic.goal.trim().length === 0;
  const pct = service.masteryPct;
  const lastAt = service.lastDigestedAt;

  return (
    <div className="pane-topic">
      <div className="pane-inner">
        <header className="topic-pane-head">
          <div className="topic-pane-head-main">
            {service.editing === 'title' ? (
              <input
                className="title-input topic-title-input"
                value={service.draftTitle}
                maxLength={200}
                autoFocus
                disabled={service.$model.commitEdit.loading}
                onChange={(event) => service.setDraftTitle(event.target.value)}
                onBlur={() => void service.commitEdit()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void service.commitEdit();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    service.cancelEdit();
                  }
                }}
              />
            ) : (
              <h1
                className="pane-title topic-title-edit"
                tabIndex={0}
                onClick={() => service.startEdit('title')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    service.startEdit('title');
                  }
                }}
              >
                {topic.title}
                {archived ? <span className="tag tag-archived">已归档</span> : null}
              </h1>
            )}
            {service.editing === 'goal' ? (
              <input
                className="topic-goal-input"
                value={service.draftGoal}
                maxLength={4000}
                autoFocus
                placeholder="一句话锚定这个专题的消化方式"
                disabled={service.$model.commitEdit.loading}
                onChange={(event) => service.setDraftGoal(event.target.value)}
                onBlur={() => void service.commitEdit()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void service.commitEdit();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    service.cancelEdit();
                  }
                }}
              />
            ) : (
              <p
                className={`topic-pane-goal${emptyGoal ? ' is-empty' : ''}`}
                tabIndex={0}
                onClick={() => service.startEdit('goal')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    service.startEdit('goal');
                  }
                }}
              >
                {emptyGoal ? '一句话锚定这个专题的消化方式' : topic.goal}
              </p>
            )}
          </div>
          <div className="topic-more-wrap">
            <button
              type="button"
              className="topic-more"
              aria-label="主题操作"
              aria-expanded={service.paneMenuOpen}
              onClick={() => service.togglePaneMenu()}
            >
              ···
            </button>
            {service.paneMenuOpen ? (
              <div className="topic-menu topic-more-menu" role="menu">
                {archived ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={service.$model.restoreSelected.loading}
                    onClick={() => void service.restoreSelected()}
                  >
                    {service.$model.restoreSelected.loading ? '恢复中…' : '取消归档'}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={service.$model.archiveSelected.loading}
                    onClick={() => void service.archiveSelected()}
                  >
                    {service.$model.archiveSelected.loading ? '归档中…' : '归档'}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  disabled={service.$model.deleteSelected.loading}
                  onClick={() => void remove()}
                >
                  {service.$model.deleteSelected.loading ? '删除中…' : '删除'}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {service.detailError ? (
          <p className="banner-error" role="alert">
            {service.detailError}
          </p>
        ) : null}

        <div className="topic-statbar">
          <span>{`${String(service.cardCount)} 张卡`}</span>
          <span className="sep">·</span>
          <span>{`${String(service.documentCount)} 篇文档`}</span>
          <span className="sep">·</span>
          <span className="topic-stat-mastery">
            掌握度 {`${String(pct)}%`}
            <span
              className="topic-mastery"
              role="progressbar"
              aria-label="掌握度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <i style={{ width: `${String(pct)}%` }} />
            </span>
          </span>
          <span className="sep">·</span>
          <span>{lastAt ? `最近消化 ${formatRelativeTime(lastAt)}` : '还没有消化'}</span>
          <span className="sep">·</span>
          <button
            type="button"
            className="topic-cov-chip"
            onClick={() => service.setTab('map')}
          >
            {`地图覆盖 ${String(service.coveredCount)}/${String(service.mapNodeCount)} →`}
          </button>
        </div>

        <TopicSearch />
      </div>
    </div>
  );
});

const DocsTab = observer(function DocsTab() {
  const service = useService(TopicsService);
  const archived = service.topic?.status === 'archived';
  const sending = service.$model.send.loading;
  const askClass = ['btn', 'btn-ghost', service.draftLooksLikeQuestion ? 'is-accent' : '']
    .filter(Boolean)
    .join(' ');

  const submit = (mode: 'auto' | 'chat') => {
    if (archived) return;
    void service.send(mode);
  };

  return (
    <div className="topic-docs">
      <div className={`pane-capture${archived ? ' is-disabled' : ''}`}>
        <div className="capture">
          <textarea
            rows={2}
            autoComplete="off"
            placeholder={archived ? '已归档，不能再往这个主题扔内容' : '扔一句话进来，或以问号结尾问 AI…'}
            value={service.draft}
            disabled={archived}
            onChange={(event) => service.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isSubmitHotkey(event)) {
                event.preventDefault();
                submit('auto');
              }
            }}
          />
          <div className="capture-bar">
            <div className="capture-actions">
              <button
                type="button"
                className={askClass}
                disabled={!service.canSend}
                onClick={() => submit('chat')}
              >
                {sending ? '提问中…' : '问 AI'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!service.canSend}
                onClick={() => submit('auto')}
              >
                {sending ? '投入中…' : '扔进去'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {service.documents.length === 0 && !service.$model.openTopic.loading ? (
        <p className="hint">这张纸还是空的。扔一句话进来。</p>
      ) : null}
      {service.documents.length > 0 ? (
        <div className="topic-doc-grid">
          {service.documents.map((doc) => (
            <TopicDocCard key={doc.id} doc={doc} />
          ))}
        </div>
      ) : null}
      {service.hasMoreDocs ? (
        <div className="ws-more">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={service.$model.loadMoreDocs.loading}
            onClick={() => void service.loadMoreDocs()}
          >
            {service.$model.loadMoreDocs.loading ? '载入中…' : '更早的文档'}
          </button>
        </div>
      ) : null}
    </div>
  );
});

function cardExcerpt(doc: DocumentListItem): string | null {
  const summary = docSummaryLine(doc);
  if (summary) return summary;
  if (doc.source === 'chat' && doc.answer) return summarizeAnswer(doc.answer, 96);
  return null;
}

const TopicDocCard = observer(function TopicDocCard({ doc }: { doc: DocumentListItem }) {
  const service = useService(TopicsService);
  const navigate = useNavigate();
  const kind = rowKindTag(doc);
  const excerpt = cardExcerpt(doc);
  const hanging = service.hangingTitle(doc);
  return (
    <button
      type="button"
      className="topic-doc-card"
      onClick={() => {
        const to = service.readerNavForDoc(doc.id, doc.fileMime);
        if (to) navigate(to);
      }}
    >
      <h3>
        {docDisplayTitle(doc)}
        {kind ? (
          <Tag tone={kind.tone}>
            {kind.pulse ? <span className="pulse" /> : null}
            {kind.pulse ? '\u00a0' : null}
            {kind.label}
          </Tag>
        ) : null}
        {doc.status === 'failed' ? <span className="doc-failed">失败</span> : null}
      </h3>
      {excerpt ? <p className="excerpt">{excerpt}</p> : null}
      <p className="meta">
        {`${String(doc.cardCount)} 张卡 · ${formatRelativeTime(doc.updatedAt)}`}
      </p>
      {hanging ? (
        <p className="hang">
          挂在：<b>{hanging}</b>
        </p>
      ) : null}
    </button>
  );
});

function rowKindTag(
  doc: DocumentListItem,
): { tone: 'ai' | 'busy'; label: string; pulse?: boolean } | null {
  if (doc.status === 'pending') return { tone: 'busy', label: '消化中', pulse: true };
  const agent = agentDocumentMetaLabel(doc.source, doc.title);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  return null;
}

const TopicSearch = observer(function TopicSearch() {
  const service = useService(TopicsService);
  const search = useService(SearchService);

  return (
    <>
      <div className="topic-tool-row">
        <div className="topic-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={service.tab === 'docs'}
            className={service.tab === 'docs' ? 'is-on' : undefined}
            onClick={() => service.setTab('docs')}
          >
            文档
            <span className="cnt">{String(service.documentCount)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={service.tab === 'map'}
            className={service.tab === 'map' ? 'is-on' : undefined}
            onClick={() => service.setTab('map')}
          >
            图谱
            <span className="cnt">{String(service.mapNodeCount)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={service.tab === 'feed'}
            className={service.tab === 'feed' ? 'is-on' : undefined}
            onClick={() => service.setTab('feed')}
          >
            动态
          </button>
        </div>
        <div className="topic-search">
          <SearchBox placeholder="搜索这个主题的文档和卡片…" />
        </div>
      </div>
      {search.hasQuery ? (
        <div className="topic-search-results">
          <SearchResults />
        </div>
      ) : (
        <>
          {service.tab === 'docs' ? <DocsTab /> : null}
          {service.tab === 'map' ? <MapTab /> : null}
          {service.tab === 'feed' ? <FeedTab /> : null}
        </>
      )}
    </>
  );
});

export const TopicsPage = bindServices(TopicsPageContent, [
  TopicsService,
  SearchService,
  ReaderService,
]);
