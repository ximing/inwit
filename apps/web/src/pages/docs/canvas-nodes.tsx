import type { Annotation } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DocsService } from './docs.service';
import { MIND_NEW_TEXT } from './mindmap-edit';
import { mindDraftAfter, mindDraftKeyCommand } from './mindmap-gesture';

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

export const CanvasNoteNode = observer(function CanvasNoteNode({
  item,
  editing,
  onCloseEdit,
}: {
  item: Annotation;
  editing: boolean;
  onCloseEdit: () => void;
}) {
  const service = useService(DocsService);
  const skipBlur = useRef(false);
  const [draft, setDraft] = useState(item.note);
  const on = service.activeAnnotationId === item.id;

  useEffect(() => {
    if (!editing) setDraft(item.note);
  }, [editing, item.note]);

  const commit = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const next = mindDraftAfter(item.note, draft, 'commit');
    onCloseEdit();
    if (!next.save) return;
    void service.saveAnnotationNote(item.id, next.text).then((ok) => {
      if (!ok) setDraft(item.note);
    });
  };

  return (
    <div
      className={`canvas-node is-note${on ? ' is-on' : ''}${editing ? ' is-editing' : ''}`}
      data-annotation-id={item.id}
    >
      <p className="canvas-node-kicker">{noteKicker(item)}</p>
      {item.imageKey ? <NoteThumb annotationId={item.id} /> : null}
      <p className="canvas-node-quote">{item.quote}</p>
      {editing ? (
        <textarea
          rows={3}
          value={draft}
          maxLength={20_000}
          autoFocus
          aria-label="编辑批注"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            const command = mindDraftKeyCommand(event.key, event.metaKey || event.ctrlKey);
            if (!command) return;
            event.stopPropagation();
            if (command === 'cancel') {
              event.preventDefault();
              skipBlur.current = true;
              setDraft(mindDraftAfter(item.note, draft, 'cancel').text);
              onCloseEdit();
              return;
            }
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
      ) : item.note.trim() ? (
        <p className="canvas-node-note">{item.note}</p>
      ) : null}
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
  editing,
  onCloseEdit,
}: {
  id: string;
  kind: 'text' | 'image';
  text: string;
  imageKey: string | null;
  editing: boolean;
  onCloseEdit: () => void;
}) {
  const service = useService(DocsService);
  const skipBlur = useRef(false);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [editing, text]);

  const commit = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const next = mindDraftAfter(text, draft, 'commit');
    onCloseEdit();
    if (!next.save) return;
    void service.saveCanvasText(id, next.text).then((ok) => {
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
          onFocus={(event) => {
            if (text === MIND_NEW_TEXT) event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            const command = mindDraftKeyCommand(event.key, event.metaKey || event.ctrlKey);
            if (!command) return;
            event.stopPropagation();
            if (command === 'cancel') {
              event.preventDefault();
              skipBlur.current = true;
              setDraft(mindDraftAfter(text, draft, 'cancel').text);
              onCloseEdit();
              return;
            }
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
      ) : null}
      {kind === 'text' && !editing ? <p className="canvas-node-text">{text}</p> : null}
    </div>
  );
});
