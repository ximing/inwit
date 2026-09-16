import { observer, useService } from '@rabjs/react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { docAnchors } from '@/lib/anchors';
import { ROUTES } from '@/routes';
import { CardRail } from './card-rail';
import { DocsService } from './docs.service';
import { DocPaneMeta } from './doc-pane-meta';
import { EditorService } from './editor.service';
import { PaperEditor } from './paper-editor';
import { PaneChrome } from './pane-chrome';

export const PaneEdit = observer(function PaneEdit({ docId }: { docId: string | null }) {
  const service = useService(DocsService);
  const editor = useService(EditorService);
  const navigate = useNavigate();
  const anchors = useMemo(
    () => docAnchors(service.doc?.cards ?? [], service.annotations),
    [service.doc, service.annotations],
  );

  if (editor.phase === 'missing') {
    return (
      <div className="pane-inner">
        <p className="empty">
          {editor.error ?? '找不到这份文档。'}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => navigate(ROUTES.docs)}>
            回文档列表
          </button>
        </p>
      </div>
    );
  }

  const metaDoc =
    service.doc && editor.id && service.doc.id === editor.id ? service.doc : null;

  return (
    <div className="pane-doc is-editing">
      <PaneChrome editing docId={docId} />
      <div className="pane-main">
        <div className="pane-scroll">
          <div className="pane-inner">
            {editor.phase === 'loading' ? (
              <p className="empty">打开这张纸…</p>
            ) : (
              <>
                <input
                  className="title-input"
                  value={editor.draftTitle}
                  placeholder="无标题"
                  aria-label="标题"
                  onChange={(event) => editor.noteTitleChange(event.target.value)}
                />
                {metaDoc ? (
                  <DocPaneMeta
                    docId={metaDoc.id}
                    updatedAt={metaDoc.updatedAt}
                    cardCount={metaDoc.cards.length}
                    status={metaDoc.status}
                    source={metaDoc.source}
                  />
                ) : null}
                {editor.phase === 'new' || editor.phase === 'ready' ? (
                  <PaperEditor
                    seedKey={editor.seedKey}
                    seedMarkdown={editor.seedMarkdown}
                    documentId={editor.id ?? service.doc?.id ?? null}
                    anchors={anchors}
                    activeCardId={service.activeCardId}
                    activeAnnotationId={service.activeAnnotationId}
                    onChange={(markdown) => editor.noteChange(markdown)}
                    onSave={() => void editor.save()}
                    onAnchorClick={(ids) => service.openAnchors(ids)}
                    onAnnotationClick={(ids) => {
                      const id = ids[0];
                      if (id) service.openAnnotation(id);
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
        {service.doc || editor.id ? <CardRail /> : null}
      </div>
    </div>
  );
});
