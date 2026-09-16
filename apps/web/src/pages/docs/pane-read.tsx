import {
  AGENT_DOC_LABEL_REPORT,
  agentDocumentMetaLabel,
  docDisplayTitle,
} from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Loader2, PenLine } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DocView } from '@/components/doc/DocView';
import { Tag } from '@/components/tag';
import { docAnchors } from '@/lib/anchors';
import { ROUTES } from '@/routes';
import { CardRail } from './card-rail';
import { DocsService } from './docs.service';
import { DocPaneMeta } from './doc-pane-meta';
import { PaneChrome } from './pane-chrome';
import { ReadSelectionToolbar } from './selection-toolbar';

const PdfPane = lazy(() => import('./pdf-pane'));

export function PaneEmpty() {
  return (
    <div className="pane-empty">
      <PenLine className="pane-empty-ico" strokeWidth={1.4} aria-hidden />
      <p className="pane-empty-title">从左边选一篇，或者直接扔一句话</p>
      <p className="pane-empty-sub">阅读、编辑、卡片都在这一个窗格里完成</p>
    </div>
  );
}

export const PaneRead = observer(function PaneRead() {
  const service = useService(DocsService);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlAnchor = params.get('anchor');
  const doc = service.doc;
  const anchors = useMemo(
    () => docAnchors(doc?.cards ?? [], service.annotations),
    [doc, service.annotations],
  );

  if (service.$model.loadDoc.loading && !doc) {
    return (
      <div className="pane-inner">
        <p className="empty">打开这张纸…</p>
      </div>
    );
  }

  if (service.docError && !doc) {
    return (
      <div className="pane-inner">
        <p className="empty">
          {service.docError}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => navigate(ROUTES.docs)}>
            回文档列表
          </button>
        </p>
      </div>
    );
  }

  if (!doc) return null;

  const isPdf = doc.fileMime === 'application/pdf';
  const isReport = agentDocumentMetaLabel(doc.source, doc.title) === AGENT_DOC_LABEL_REPORT;
  const stage = service.stageFor(doc);
  const emptyHint =
    stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label
      ? stage.label
      : '这张纸还是空的，写点什么吧';

  return (
    <div className="pane-doc">
      <PaneChrome editing={false} docId={doc.id} hideModeSwitch={isPdf} />
      <div className="pane-main">
        <div className={`pane-scroll${isPdf ? ' is-pdf' : ''}`}>
          {isPdf ? (
            <Suspense
              fallback={
                <p className="empty">
                  <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                  正在打开…
                </p>
              }
            >
              <PdfPane />
            </Suspense>
          ) : (
            <div className="pane-inner">
              <h1 className="pane-title">
                {docDisplayTitle(doc)}
                {isReport ? <Tag tone="ai">AI 复盘</Tag> : null}
              </h1>
              <DocPaneMeta
                docId={doc.id}
                updatedAt={doc.updatedAt}
                cardCount={doc.cards.length}
                status={doc.status}
                source={doc.source}
                contentMd={doc.contentMd}
              />

              <article className="paper">
                {doc.linkHint ? <aside className="doc-link-hint">{doc.linkHint}</aside> : null}
                {doc.source === 'chat' && doc.answer ? (
                  <aside className="doc-answer">
                    <p className="doc-answer-kicker">AI 回答</p>
                    <DocView source={doc.answer} />
                  </aside>
                ) : null}
                {doc.contentMd.trim().length > 0 ? (
                  <DocView
                    source={doc.contentMd}
                    anchors={anchors}
                    activeCardId={service.activeCardId}
                    activeAnnotationId={service.activeAnnotationId}
                    focusCardId={urlAnchor}
                    onAnchorClick={(ids) => service.openAnchors(ids)}
                    onAnnotationClick={(ids) => {
                      const id = ids[0];
                      if (id) service.openAnnotation(id);
                    }}
                  />
                ) : (
                  <p className="empty">{emptyHint}</p>
                )}
              </article>
            </div>
          )}
        </div>
        <CardRail />
      </div>
      {isPdf ? null : <ReadSelectionToolbar />}
    </div>
  );
});
