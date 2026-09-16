import { observer, useService } from '@rabjs/react';
import { docDisplayTitle, type MapNodeStatus, type MapTreeNode } from '@inwit/dto';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { DocRow } from '@/components/doc-row';
import { cardPath, docPath } from '@/routes';
import { chapterMeta, TopicsService } from './topics.service';

export const MapTab = observer(function MapTab() {
  const service = useService(TopicsService);
  const archived = service.topic?.status === 'archived';

  if (service.emptyMap) {
    return (
      <div className="map-empty">
        <p className="empty">{service.organizing ? '正在长出地图…' : '还没有地图'}</p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={archived || service.jobRunning}
          onClick={() => void service.organize()}
        >
          {service.organizing ? (
            <>
              <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
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
    <div className="map-pane">
      <div className="map-toolbar">
        <p className="map-coverage">
          {`已覆盖 ${String(service.coveredCount)}/${String(service.summary?.totalNodes ?? 0)} 概念`}
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={archived || service.jobRunning}
          onClick={() => void service.organize()}
        >
          {service.organizing ? (
            <>
              <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
              整理中…
            </>
          ) : (
            '整理地图'
          )}
        </button>
      </div>
      <div className="map-tree">
        {service.tree.map((node) => (
          <MapBranch key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
});

export const FeedTab = observer(function FeedTab() {
  const service = useService(TopicsService);

  if (service.documents.length === 0) {
    return <p className="empty compact">这个主题还没有资料。到「文档」里扔一点进来。</p>;
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
          className="btn btn-secondary load-more"
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
  const service = useService(TopicsService);
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
  const service = useService(TopicsService);
  return (
    <div className="map-row" style={{ paddingLeft: depth * 20 }}>
      <button
        type="button"
        className="map-row-main"
        aria-expanded={!collapsed}
        onClick={() => service.toggleCollapsed(node.id)}
      >
        <span className="map-chevron" aria-hidden="true">
          {collapsed ? (
            <ChevronRight width={14} height={14} strokeWidth={1.8} />
          ) : (
            <ChevronDown width={14} height={14} strokeWidth={1.8} />
          )}
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
  const service = useService(TopicsService);
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
          className="btn btn-ghost map-fill"
          disabled={service.topic?.status === 'archived' || service.jobRunning}
          onClick={() => void service.fill(node.id)}
        >
          {filling ? (
            <>
              <Loader2 className="icon-spin" width={12} height={12} strokeWidth={1.8} />
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

export const NodeDrawer = observer(function NodeDrawer() {
  const service = useService(TopicsService);
  const open = service.drawerOpen;
  const detail = service.nodeDetail;
  const loading = service.$model.openNode.loading && service.selectedNodeId !== null;

  useEffect(() => {
    if (!open) return;
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
  }, [service, open]);

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
        <button type="button" className="btn btn-ghost" onClick={() => service.closeDrawer()}>
          收起
        </button>
      </div>
      {loading && !detail ? <p className="empty compact">打开节点…</p> : null}
      {detail ? (
        <div className="node-drawer-body">
          <h2 className="node-drawer-title">{detail.node.title}</h2>
          {detail.node.note ? <p className="node-note">{detail.node.note}</p> : null}

          <h3 className="node-subhead">卡片</h3>
          {detail.cards.length === 0 ? <p className="lede">这个节点还没有卡片。</p> : null}
          <ul className="node-card-list">
            {detail.cards.map((card) => (
              <li key={card.id}>
                <Link
                  to={cardPath(card.id, card.documentId)}
                  className="related-card related-card-link"
                >
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
                <Link to={docPath(doc.id)}>{docDisplayTitle(doc)}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
});
