import type { Annotation } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresignedThumb, usePresignedImage } from '@/components/presigned-thumb';
import { Tip } from '@/components/tip';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DialogService } from '@/services/dialog.service';
import { DocsService } from './docs.service';
import { MIND_NEW_TEXT } from './mindmap-edit';
import { mindDraftAfter, mindDraftDirty, mindDraftKeyCommand } from './mindmap-gesture';

function noteKicker(item: Annotation): string {
  if (item.kind === 'pdf') return `PDF ${(item.pageIndex ?? 0) + 1}`;
  if (item.kind === 'media') return '摘录';
  if (item.kind === 'note') return '想法';
  return '批注';
}

/**
 * Esc 取消节点编辑：无改动直接退；有改动弹确认，确认后丢弃草稿。
 * 确认框会抢走焦点触发 textarea blur，先把 skipBlur 立起来避免被当成提交。
 * 放弃时不复位 skipBlur：卸载时的 blur 靠它吞掉（与既有 Esc 路径同一模式）。
 */
function cancelDraftEdit(input: {
  saved: string;
  draft: string;
  setDraft: (value: string) => void;
  onCloseEdit: () => void;
  skipBlur: { current: boolean };
  area: HTMLTextAreaElement | null;
  dialog: DialogService;
}): void {
  const discard = () => {
    input.setDraft(mindDraftAfter(input.saved, input.draft, 'cancel').text);
    input.onCloseEdit();
  };
  if (!mindDraftDirty(input.saved, input.draft)) {
    input.skipBlur.current = true;
    discard();
    return;
  }
  input.skipBlur.current = true;
  void input.dialog
    .confirm('有未保存的修改，放弃吗？', { title: '退出编辑', ok: '放弃', danger: true })
    .then((ok) => {
      if (ok) {
        discard();
        return;
      }
      input.skipBlur.current = false;
      input.area?.focus();
    });
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
  const dialog = useService(DialogService);
  const skipBlur = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(item.note);
  const on = service.activeAnnotationId === item.id;

  useEffect(() => {
    // 进入编辑态重置 skipBlur：卸载聚焦的 textarea 不一定触发 blur，
    // 上次 Esc 取消立的标志若留到这次编辑，会把失焦提交吞掉（内容丢失）。
    if (editing) {
      skipBlur.current = false;
      return;
    }
    setDraft(item.note);
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
      {item.quote.trim() ? <p className="canvas-node-quote">{item.quote}</p> : null}
      {editing ? (
        <textarea
          rows={3}
          value={draft}
          maxLength={20_000}
          autoFocus
          ref={areaRef}
          aria-label="编辑批注"
          onFocus={(event) => {
            if (item.note === MIND_NEW_TEXT) event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            const command = mindDraftKeyCommand(
              event.key,
              event.metaKey || event.ctrlKey,
              event.shiftKey,
            );
            if (!command) return;
            event.stopPropagation();
            if (command === 'cancel') {
              event.preventDefault();
              cancelDraftEdit({
                saved: item.note,
                draft,
                setDraft,
                onCloseEdit,
                skipBlur,
                area: areaRef.current,
                dialog,
              });
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
  const dialog = useService(DialogService);
  const skipBlur = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (editing) {
      skipBlur.current = false;
      return;
    }
    setDraft(text);
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
      <Tip content="删除">
      <button
        type="button"
        className="canvas-node-op"
        aria-label="删除节点"
        onClick={(event) => {
          event.stopPropagation();
          void service.removeCanvasNode(id);
        }}
      >
        <Trash2 width={13} height={13} strokeWidth={1.8} />
      </button>
      </Tip>
      {kind === 'image' && imageKey ? <CanvasImage imageKey={imageKey} /> : null}
      {kind === 'text' && editing ? (
        <textarea
          rows={3}
          value={draft}
          maxLength={4000}
          autoFocus
          ref={areaRef}
          aria-label="编辑文本"
          onFocus={(event) => {
            if (text === MIND_NEW_TEXT) event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            const command = mindDraftKeyCommand(
              event.key,
              event.metaKey || event.ctrlKey,
              event.shiftKey,
            );
            if (!command) return;
            event.stopPropagation();
            if (command === 'cancel') {
              event.preventDefault();
              cancelDraftEdit({
                saved: text,
                draft,
                setDraft,
                onCloseEdit,
                skipBlur,
                area: areaRef.current,
                dialog,
              });
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
