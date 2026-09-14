import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import type { MapNodeStatus, MapTreeNode } from '@inwit/dto';
import { DocRow } from '@/components/doc-row';
import { cardPath, docPath, ROUTES } from '@/routes';
import { chapterMeta, TopicService } from './topic.service';

const TopicDetailContent = observer(function TopicDetailContent() {
  const service = useService(TopicService);
  const { id } = useParams();

  useEffect(() => {
    if (id) void service.load(id);
    return () => service.stopPolling();
  }, [id, service]);

  useEffect(() => {
    if (!service.drawerOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.card-drawer')) return;
      if (target.closest('.map-concept')) return;
      service.closeDrawer();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') service.closeDrawer();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [service, service.drawerOpen]);

  const topic = service.topic;
  const archived = topic?.status === 'archived';
  const summary = service.summary;

  return (
    <section className={`page-topic${service.drawerOpen ? ' is-drawer-open' : ''}`}>
      {service.$model.load.loading && !topic ? <p className="empty">打开主题…</p> : null}

      {service.error ? (
        <p className="banner-error" role="alert">
          {service.error} <Link to={ROUTES.topics}>回主题列表</Link>
        </p>
      ) : null}

      {topic ? (
        <>
          <header className="topic-head">
            <div className="topic-head-row">
              <h1>{topic.title}</h1>
              <div className="topic-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={archived || service.jobRunning}
                  onClick={() => void service.organize()}
                >
                  {service.organizing ? (
                    <>
                      <span className="spin" aria-hidden="true" />
                      整理中…
                    </>
                  ) : (
                    '整理地图'
                  )}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={archived || service.busyArchive}
                  onClick={() => void service.archive()}
                >
                  {service.busyArchive ? '归档中…' : archived ? '已归档' : '归档'}
                </button>
              </div>
            </div>
            <p className="topic-goal">目标：{topic.goal ?? '还没写学习目标'}</p>
            <div
              className="coverage-track"
              role="progressbar"
              aria-label="覆盖率"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={service.coveragePct}
            >
              <div className="coverage-bar" style={{ width: `${String(service.coveragePct)}%` }} />
            </div>
            <p className="meta topic-stats">
              {`已覆盖 ${String(service.coveredCount)}/${String(summary?.totalNodes ?? 0)} 概念 · ${String(summary?.cardCount ?? 0)} 张卡 · 掌握 ${String(summary?.masteryPct ?? 0)}%`}
            </p>
          </header>

          <div className="map-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={service.tab === 'map'}
              className={service.tab === 'map' ? 'is-on' : undefined}
              onClick={() => service.setTab('map')}
            >
              地图
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={service.tab === 'feed'}
              className={service.tab === 'feed' ? 'is-on' : undefined}
              onClick={() => service.setTab('feed')}
            >
              资料流
            </button>
          </div>

          {service.tab === 'map' ? <MapTab /> : <FeedTab />}
        </>
      ) : null}

      <NodeDrawer />
    </section>
  );
});

const MapTab = observer(function MapTab() {
  const service = useService(TopicService);

  if (service.emptyMap) {
    return (
      <div className="map-empty">
        <p className="empty">{service.organizing ? '正在长出地图…' : '还没有地图'}</p>
        <button
          type="button"
          className="btn-primary"
          disabled={service.topic?.status === 'archived' || service.jobRunning}
          onClick={() => void service.organize()}
        >
          {service.organizing ? (
            <>
              <span className="spin" aria-hidden="true" />
              整理中…
            </>
          ) : (
            '让 AI 整理一张地图'
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="map-tree">
      {service.tree.map((node) => (
        <MapBranch key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
});

const FeedTab = observer(function FeedTab() {
  const service = useService(TopicService);

  if (service.documents.length === 0) {
    return <p className="empty">这个主题还没有资料。回文档页扔一点进来。</p>;
  }

  return (
    <>
      <div className="doc-list">
        {service.documents.map((doc) => (
          <DocRow key={doc.id} doc={doc} hanging={service.hangingTitle(doc)} />
        ))}
      </div>
      {service.hasMoreDocs ? (
        <button
          type="button"
          className="btn-secondary load-more"
          disabled={service.$model.loadMoreDocs.loading}
          onClick={() => void service.loadMoreDocs()}
        >
          {service.$model.loadMoreDocs.loading ? '载入中…' : '更早的文档'}
        </button>
      ) : null}
    </>
  );
});

const MapBranch = observer(function MapBranch({
  node,
  depth,
}: {
  node: MapTreeNode;
  depth: number;
}) {
  const service = useService(TopicService);
  const isChapter = node.children.length > 0;
  const collapsed = service.isCollapsed(node.id);

  return (
    <>
      {isChapter ? (
        <ChapterRow node={node} depth={depth} collapsed={collapsed} />
      ) : (
        <ConceptRow node={node} depth={depth} />
      )}
      {isChapter && !collapsed
        ? node.children.map((child) => <MapBranch key={child.id} node={child} depth={depth + 1} />)
        : null}
    </>
  );
});

const ChapterRow = observer(function ChapterRow({
  node,
  depth,
  collapsed,
}: {
  node: MapTreeNode;
  depth: number;
  collapsed: boolean;
}) {
  const service = useService(TopicService);
  return (
    <div className="map-row" style={{ paddingLeft: depth * 20 }}>
      <button
        type="button"
        className="map-row-main"
        aria-expanded={!collapsed}
        onClick={() => service.toggleCollapsed(node.id)}
      >
        <span className="map-chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="map-chapter">{node.title}</span>
        <span className="map-meta">{chapterMeta(node)}</span>
      </button>
    </div>
  );
});

const ConceptRow = observer(function ConceptRow({
  node,
  depth,
}: {
  node: MapTreeNode;
  depth: number;
}) {
  const service = useService(TopicService);
  const filling = service.fillingNodeId === node.id;
  const uncovered = node.status === 'uncovered';
  return (
    <div
      className={`map-row map-concept${service.selectedNodeId === node.id ? ' is-on' : ''}`}
      style={{ paddingLeft: depth * 20 }}
    >
      <button type="button" className="map-row-main" onClick={() => void service.openNode(node.id)}>
        <StatusDot status={node.status} />
        <span className={`map-concept-title${uncovered ? ' is-blank' : ''}`}>{node.title}</span>
        {node.cardCount > 0 ? <span className="map-badge">{node.cardCount}卡</span> : null}
        {node.docCount > 0 ? <DocGlyph /> : null}
      </button>
      {uncovered ? (
        <button
          type="button"
          className="btn-ghost map-fill"
          disabled={service.topic?.status === 'archived' || service.jobRunning}
          onClick={() => void service.fill(node.id)}
        >
          {filling ? (
            <>
              <span className="spin" aria-hidden="true" />
              让 AI 补
            </>
          ) : (
            '让 AI 补'
          )}
        </button>
      ) : null}
    </div>
  );
});

function StatusDot({ status }: { status: MapNodeStatus }) {
  const label = status === 'covered' ? '掌握' : status === 'learning' ? '在学' : '空白';
  return <span className={`map-dot is-${status}`} title={label} aria-label={label} />;
}

function DocGlyph() {
  return (
    <svg
      className="map-doc-icon"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="有资料"
    >
      <rect x="4" y="2.5" width="8" height="11" rx="1.2" />
      <path d="M6 6h4M6 8.5h4M6 11h2.5" />
    </svg>
  );
}

const NodeDrawer = observer(function NodeDrawer() {
  const service = useService(TopicService);
  const open = service.drawerOpen;
  const detail = service.nodeDetail;
  const loading = service.$model.openNode.loading && service.selectedNodeId !== null;

  return (
    <aside
      className={`card-drawer${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label="节点详情"
      inert={!open || undefined}
    >
      <div className="card-drawer-head">
        <p className="doc-answer-kicker">节点</p>
        <button type="button" className="btn-ghost" onClick={() => service.closeDrawer()}>
          收起
        </button>
      </div>
      {loading && !detail ? <p className="empty">打开节点…</p> : null}
      {detail ? (
        <div className="node-drawer-body">
          <h2 className="node-drawer-title">{detail.node.title}</h2>
          {detail.node.note ? <p className="node-note">{detail.node.note}</p> : null}

          <h3 className="node-subhead">卡片</h3>
          {detail.cards.length === 0 ? <p className="lede">这个节点还没有卡片。</p> : null}
          <ul className="node-card-list">
            {detail.cards.map((card) => (
              <li key={card.id}>
                <Link to={cardPath(card.id)} className="related-card related-card-link">
                  <h4>{card.concept}</h4>
                  {card.tags.length > 0 ? (
                    <ul className="tag-row">
                      {card.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="node-subhead">资料</h3>
          {detail.documents.length === 0 ? <p className="lede">这个节点还没有资料。</p> : null}
          <ul className="related-sheet-list">
            {detail.documents.map((doc) => (
              <li key={doc.id}>
                <Link to={docPath(doc.id)}>{doc.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
});

export const TopicDetailPage = bindServices(TopicDetailContent, [TopicService]);
