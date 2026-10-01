import type { Annotation } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DocsService } from './docs.service';

function noteKicker(item: Annotation): string {
  if (item.kind === 'pdf') return `PDF ${(item.pageIndex ?? 0) + 1}`;
  if (item.kind === 'media') return '摘录';
  return '批注';
}

const NoteThumb = observer(function NoteThumb({ annotationId }: { annotationId: string }) {
  const service = useService(DocsService);
  const url = service.annotationImageUrl(annotationId);
  usePresignedImage(annotationId, url, (id) => void service.loadAnnotationImage(id));
  return (
    <PresignedThumb
      url={url}
      className="canvas-note-thumb"
      onError={() => service.retryAnnotationImage(annotationId)}
    />
  );
});

export const CanvasNoteNode = observer(function CanvasNoteNode({ item }: { item: Annotation }) {
  const service = useService(DocsService);
  const on = service.activeAnnotationId === item.id;
  return (
    <div
      className={`canvas-node is-note${on ? ' is-on' : ''}`}
      data-annotation-id={item.id}
      onClick={() => service.focusAnnotation(item.id)}
    >
      <p className="canvas-node-kicker">{noteKicker(item)}</p>
      {item.imageKey ? <NoteThumb annotationId={item.id} /> : null}
      <p className="canvas-node-quote">{item.quote}</p>
      {item.note.trim() ? <p className="canvas-node-note">{item.note}</p> : null}
    </div>
  );
});

const CanvasImage = observer(function CanvasImage({ imageKey }: { imageKey: string }) {
  const assets = useService(AssetUrlsService);
  const src = `asset:${imageKey}`;
  const url = assets.urlFor(src);
  useEffect(() => {
    void assets.ensure([src]);
  }, [assets, src]);
  return url ? <img src={url} alt="" /> : <span className="canvas-node-pending">图片</span>;
});

export const CanvasFreeNode = observer(function CanvasFreeNode({
  id,
  kind,
  text,
  imageKey,
}: {
  id: string;
  kind: 'text' | 'image';
  text: string;
  imageKey: string | null;
}) {
  const service = useService(DocsService);
  const skipBlur = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [editing, text]);

  const commit = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    setEditing(false);
    if (draft.trim() === text) return;
    void service.saveCanvasText(id, draft).then((ok) => {
      if (!ok) setDraft(text);
    });
  };

  return (
    <div className={`canvas-node is-${kind}${editing ? ' is-editing' : ''}`}>
      <button
        type="button"
        className="canvas-node-op"
        aria-label="删除节点"
        title="删除"
        onClick={(event) => {
          event.stopPropagation();
          void service.removeCanvasNode(id);
        }}
      >
        <Trash2 width={13} height={13} strokeWidth={1.8} />
      </button>
      {kind === 'image' && imageKey ? <CanvasImage imageKey={imageKey} /> : null}
      {kind === 'text' && editing ? (
        <textarea
          rows={3}
          value={draft}
          maxLength={4000}
          autoFocus
          aria-label="编辑文本"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              skipBlur.current = true;
              setDraft(text);
              setEditing(false);
            }
          }}
        />
      ) : null}
      {kind === 'text' && !editing ? (
        <p className="canvas-node-text" onClick={() => setEditing(true)}>
          {text}
        </p>
      ) : null}
    </div>
  );
});
