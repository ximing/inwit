import { observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { ListTree, Loader2, Network, Plus, Search } from 'lucide-react';
import { shortcutBlockedTarget } from '../study-workspace/study-mode-hotkey.js';
import { ConceptsService } from './concepts.service.js';
import { ConceptGraph } from './concept-graph.js';
import { ConceptDetailPane, RelationDetailPane } from './concept-detail.js';
import { ConceptBatchPanel } from './concept-batch-panel.js';
import { ConceptEditorDialog, ConceptLinkDraft, RelationEditorDialog } from './concept-editor.js';

/**
 * 概念区面板：图/索引、详情、编辑、候选批次。
 * 文章（本文范围）与主题（跨文章汇总）共用。
 */
export const ConceptsPanel = observer(function ConceptsPanel() {
  const service = useService(ConceptsService);
  const detailOpen = service.detail !== null;

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (shortcutBlockedTarget(event.target)) return;
      event.preventDefault();
      void service.select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailOpen, service]);

  if (service.probed && !service.enabled) return null;
  if (!service.probed) {
    return (
      <div className="concepts-panel is-loading">
        <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
      </div>
    );
  }

  const showBatch = service.batch !== null && service.batchPhase !== 'idle';

  return (
    <div className="concepts-panel">
      <div className="concepts-toolbar">
        <button
          type="button"
          className={`concepts-view-btn${service.viewMode === 'graph' ? ' is-active' : ''}`}
          onClick={() => (service.viewMode = 'graph')}
          aria-label="关系图"
        >
          <Network width={14} height={14} strokeWidth={1.8} />
          关系图
        </button>
        <button
          type="button"
          className={`concepts-view-btn${service.viewMode === 'list' ? ' is-active' : ''}`}
          onClick={() => {
            service.viewMode = 'list';
            void service.loadList(true);
          }}
          aria-label="索引"
        >
          <ListTree width={14} height={14} strokeWidth={1.8} />
          索引
        </button>
        <span className="concepts-toolbar-gap" />
        {service.writable ? (
          <>
            <button type="button" className="concepts-action" onClick={() => service.openConceptEditor()}>
              <Plus width={13} height={13} strokeWidth={2} />
              新建概念
            </button>
            <button type="button" className="concepts-action" onClick={() => service.openRelationEditor()}>
              连接概念
            </button>
          </>
        ) : null}
      </div>

      {service.viewMode === 'list' ? (
        <div className="concepts-search">
          <Search width={13} height={13} strokeWidth={1.8} aria-hidden />
          <input
            value={service.query}
            placeholder="搜索名称或别名"
            onChange={(event) => service.setQuery(event.target.value)}
          />
        </div>
      ) : null}

      {service.revisionNotice ? (
        <p className="concepts-notice" role="status">概念图已更新，数据已重新加载</p>
      ) : null}
      {service.error ? (
        <p className="concepts-error" role="alert">{service.error}</p>
      ) : null}

      {showBatch ? <ConceptBatchPanel onClose={() => service.closeBatch()} /> : null}

      <div className="concepts-body">
        {service.viewMode === 'graph' ? (
          service.visibleConcepts.length === 0 && !service.loading ? (
            <div className="concepts-empty">
              <p>{service.documentId ? '本文还没有收录概念。' : '这个主题还没有概念。'}</p>
              <p className="concepts-empty-sub">
                {service.writable ? '选中正文术语「收为概念」，或让 AI 生成候选。' : '概念功能当前只读。'}
              </p>
            </div>
          ) : (
            <ConceptGraph
              concepts={service.visibleConcepts}
              relations={service.edges}
              edgesComplete={service.edgesComplete}
              positions={service.positions}
              viewport={service.viewport}
              selectedId={service.selected?.kind === 'concept' ? service.selected.id : null}
              selectedRelationId={service.selected?.kind === 'relation' ? service.selected.id : null}
              highlightConceptIds={service.highlightConceptIds}
              contextIds={new Set([...service.membershipById].filter(([, m]) => m === 'endpoint_context').map(([id]) => id))}
              highlightRelationIds={service.highlightRelationIds}
              onViewportChange={(viewport) => (service.viewport = viewport)}
              onPositionsChange={(positions) => (service.positions = positions)}
              onSelectConcept={(id) => void service.select({ kind: 'concept', id })}
              onSelectRelation={(id) => void service.select({ kind: 'relation', id })}
              onExpandNeighbors={(id) => void service.expandNeighbors(id)}
              canBack={service.focusStack.length > 0}
              onBack={() => void service.backFocus()}
              crumbs={service.focusCrumbs}
              onJumpFocus={(index) => void service.jumpFocus(index)}
              onDismiss={() => void service.select(null)}
              centerRequest={service.centerRequest}
              onConnect={
                service.writable
                  ? (fromId, toId) => service.openLinkDraft(fromId, toId)
                  : undefined
              }
            />
          )
        ) : (
          <div className="concepts-list">
            {service.listItems.map((concept) => (
              <button
                key={concept.id}
                type="button"
                className={`concepts-list-item${service.selected?.kind === 'concept' && service.selected.id === concept.id ? ' is-active' : ''}`}
                onClick={() => void service.select({ kind: 'concept', id: concept.id })}
              >
                <span className="concepts-list-name">{concept.name}</span>
                {concept.sense ? <span className="concepts-list-sense">{concept.sense}</span> : null}
                {concept.definition ? (
                  <span className="concepts-list-def">{concept.definition}</span>
                ) : null}
              </button>
            ))}
            {service.listCursor ? (
              <button type="button" className="concepts-more" onClick={() => void service.loadList(false)}>
                加载更多
              </button>
            ) : null}
            {!service.listLoading && service.listItems.length === 0 ? (
              <p className="concepts-empty-sub">没有匹配的概念。</p>
            ) : null}
          </div>
        )}

        {service.detail ? (
          'concept' in service.detail ? (
            <ConceptDetailPane detail={service.detail} onClose={() => void service.select(null)} />
          ) : (
            <RelationDetailPane detail={service.detail} onClose={() => void service.select(null)} />
          )
        ) : null}
        {service.writable && service.linkDraft ? (
          <ConceptLinkDraft
            fromId={service.linkDraft.fromId}
            toId={service.linkDraft.toId}
            onClose={() => service.closeLinkDraft()}
          />
        ) : null}
      </div>

      {service.writable && (service.editor === 'concept' || service.createPrefill !== null) ? (
        <ConceptEditorDialog onClose={() => service.closeConceptEditor()} />
      ) : null}
      {service.writable && service.editor === 'relation' ? (
        <RelationEditorDialog onClose={() => service.closeRelationEditor()} />
      ) : null}
    </div>
  );
});
