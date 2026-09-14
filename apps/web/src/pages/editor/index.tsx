import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ROUTES, docPath, editorPath } from '@/routes';
import { EditorService } from './editor.service';
import { PaperEditor } from './paper-editor';

const EditorPageContent = observer(function EditorPageContent() {
  const service = useService(EditorService);
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const topicId = params.get('topicId');

  useEffect(() => {
    void service.open(id ?? 'new', topicId);
  }, [id, topicId, service]);

  useEffect(() => {
    if (id === 'new' && service.id) {
      navigate(editorPath(service.id), { replace: true });
    }
  }, [id, service.id, navigate]);

  const backTo = service.id ? docPath(service.id) : ROUTES.home;

  return (
    <section className="page-editor">
      <header className="editor-chrome">
        <Link to={backTo} className="btn-ghost">
          返回
        </Link>
        <p className={`editor-save is-${service.saveState}`} aria-live="polite">
          {service.saveLabel}
        </p>
      </header>

      {service.phase === 'loading' ? <p className="empty">打开这张纸…</p> : null}

      {service.phase === 'missing' ? (
        <p className="empty">
          {service.error ?? '找不到这份文档。'}
          <Link to={ROUTES.home}>回文档列表</Link>
        </p>
      ) : null}

      {service.phase === 'new' || service.phase === 'ready' ? (
        <PaperEditor
          seedKey={service.seedKey}
          seedMarkdown={service.seedMarkdown}
          onChange={(markdown) => service.noteChange(markdown)}
          onSave={() => void service.save()}
        />
      ) : null}
    </section>
  );
});

export const EditorPage = bindServices(EditorPageContent, [EditorService]);
