import { observer, useService } from '@rabjs/react';
import { docDisplayTitle, type MapNodeStatus, type MapTreeNode } from '@inwit/dto';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { DocRow } from '@/components/doc-row';
import { ReaderService } from '@/components/reader/reader.service';
import { formatRelativeTime } from '@/lib/format';
import { chapterMeta, TopicsService } from './topics.service';

type MapLane = {
  id: string;
  title: string;
  meta: string;
  concepts: MapTreeNode[];
  collapsible: boolean;
};

function lanesFromTree(tree: MapTreeNode[]): MapLane[] {
  const lanes: MapLane[] = [];
  const ungrouped: MapTreeNode[] = [];
  for (const node of tree) {
    if (node.children.length > 0) {
      lanes.push({
        id: node.id,
        title: node.title,
        meta: chapterMeta(node),
        concepts: node.children,
        collapsible: true,
      });
    } else {
      ungrouped.push(node);
    }
  }
  if (ungrouped.length > 0) {
    let cards = 0;
    let docs = 0;
    for (const node of ungrouped) {
      cards += node.cardCount;
      docs += node.docCount;
    }
    lanes.push({
      id: '__ungrouped__',
      title: '其他',
      meta: docs > 0 ? `${cards}卡 · ${docs}资料` : `${cards}卡`,
      concepts: ungrouped,
      collapsible: false,
    });
  }
  return lanes;
}

function laneCoveredPct(concepts: MapTreeNode[]): number {
  if (concepts.length === 0) return 0;
  const covered = concepts.filter((node) => node.status === 'covered').length;
  return Math.round((covered / concepts.length) * 100);
}

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

  const total = service.summary?.totalNodes ?? 0;
  const lanes = lanesFromTree(service.tree);

  return (
    <div className="map-pane">
      <div className="map-toolbar">
        <p className="map-coverage">
          已覆盖{' '}
          <b>{`${String(service.coveredCount)}/${String(total)}`}</b>
          {' 概念'}
        </p>
        <span
          className="topic-mastery map-cov-bar"
          role="progressbar"
          aria-label="地图覆盖率"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={service.coveragePct}
        >
          <i style={{ width: `${String(service.coveragePct)}%` }} />
        </span>
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
        <div className="map-legend" aria-hidden>
          <span>
            <i className="map-dot is-covered" />
            已覆盖
          </span>
          <span>
            <i className="map-dot is-learning" />
            学习中
          </span>
          <span>
            <i className="map-dot is-uncovered" />
            未覆盖
          </span>
        </div>
      </div>
      <div className="map-lanes">
        {lanes.map((lane) => (
          <MapLaneColumn key={lane.id} lane={lane} />
        ))}
      </div>
    </div>
  );
});

const MapLaneColumn = observer(function MapLaneColumn({ lane }: { lane: MapLane }) {
  const service = useService(TopicsService);
  const collapsed = lane.collapsible && service.isCollapsed(lane.id);
  const pct = laneCoveredPct(lane.concepts);
  return (
    <section className="map-lane">
      {lane.collapsible ? (
        <button
          type="button"
          className="map-lane-head"
          aria-expanded={!collapsed}
          onClick={() => service.toggleCollapsed(lane.id)}
        >
          <span className="map-lane-chevron" aria-hidden>
            {collapsed ? (
              <ChevronRight width={14} height={14} strokeWidth={1.8} />
            ) : (
              <ChevronDown width={14} height={14} strokeWidth={1.8} />
            )}
          </span>
          <h3>{lane.title}</h3>
          <span className="map-lane-n">{lane.meta}</span>
        </button>
      ) : (
        <div className="map-lane-head">
          <h3>{lane.title}</h3>
          <span className="map-lane-n">{lane.meta}</span>
        </div>
      )}
      {collapsed ? null : (
        <>
          <div
            className="topic-mastery map-lane-bar"
            role="progressbar"
            aria-label={`${lane.title}覆盖率`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <i style={{ width: `${String(pct)}%` }} />
          </div>
          {lane.concepts.map((node) => (
            <ConceptCard key={node.id} node={node} />
          ))}
        </>
      )}
    </section>
  );
});

const ConceptCard = observer(function ConceptCard({ node }: { node: MapTreeNode }) {
  const service = useService(TopicsService);
  const filling = service.fillingNodeId === node.id;
  const uncovered = node.status === 'uncovered';
  const masteryPct = Math.round(node.mastery * 100);
  const on = service.selectedNodeId === node.id;
  return (
    <div
      className={`map-concept map-concept-card${uncovered ? ' is-uncovered' : ''}${on ? ' is-on' : ''}`}
    >
      <button
        type="button"
        className="map-concept-main"
        onClick={() => void service.openNode(node.id)}
      >
        <span className="map-concept-t">
          <StatusDot status={node.status} />
          {node.title}
        </span>
        <span className="map-concept-meta">{`${String(node.cardCount)}卡 · 掌握 ${String(masteryPct)}%`}</span>
      </button>
      {uncovered ? (
        <button
          type="button"
          className="map-concept-fill"
          disabled={service.topic?.status === 'archived' || service.jobRunning}
          onClick={() => void service.fill(node.id)}
        >
          {filling ? (
            <>
              <Loader2 className="icon-spin" width={12} height={12} strokeWidth={1.8} />
              让 AI 补
            </>
          ) : (
            '✦ 让 AI 补'
          )}
        </button>
      ) : null}
    </div>
  );
});

export const FeedTab = observer(function FeedTab() {
  const service = useService(TopicsService);
  const navigate = useNavigate();

  if (service.documents.length === 0) {
    return <p className="empty compact">这个主题还没有资料。到「文档」里扔一点进来。</p>;
  }

  return (
    <>
      <div className="topic-feed">
        {service.documents.map((doc) => (
          <div key={doc.id} className="topic-feed-item">
            <span className="topic-feed-time">{formatRelativeTime(doc.updatedAt)}</span>
            <div className="topic-feed-card">
              <DocRow
                doc={doc}
                hanging={service.hangingTitle(doc)}
                onOpen={(id) => {
                  const to = service.readerNavForDoc(id);
                  if (to) navigate(to);
                }}
              />
            </div>
          </div>
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

function StatusDot({ status }: { status: MapNodeStatus }) {
  const label = status === 'covered' ? '已覆盖' : status === 'learning' ? '学习中' : '未覆盖';
  return <i className={`map-dot is-${status}`} title={label} aria-label={label} />;
}

export const NodeDrawer = observer(function NodeDrawer() {
  const service = useService(TopicsService);
  const reader = useService(ReaderService);
  const navigate = useNavigate();
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
      if (target.closest('.reader-overlay-root')) return;
      service.closeDrawer();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (reader.isOpen) return;
      service.closeDrawer();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [service, reader, open]);

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
                <button
                  type="button"
                  className="related-card related-card-link"
                  onClick={() => {
                    const to = service.readerNavForCard(card.id, card.documentId);
                    if (to) navigate(to);
                  }}
                >
                  <h4>{card.concept}</h4>
                  {card.tags.length > 0 ? (
                    <ul className="tag-row">
                      {card.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <h3 className="node-subhead">资料</h3>
          {detail.documents.length === 0 ? <p className="lede">这个节点还没有资料。</p> : null}
          <ul className="related-sheet-list">
            {detail.documents.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => {
                    const to = service.readerNavForDoc(doc.id);
                    if (to) navigate(to);
                  }}
                >
                  {docDisplayTitle(doc)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
});
