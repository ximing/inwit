import { observer, useService } from '@rabjs/react';
import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tip } from '@/components/tip';
import { imeBlocksEnterFromEvent } from '@/lib/ime-enter';
import { DocsService } from './docs.service';
import { putThoughtDraft, thoughtDraftFor, thoughtDraftRevision } from './thought-draft';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * 记一条想法的输入区：文字 + 可选贴图。批注栏顶部常驻与浮动输入框共用。
 * 提交后清空并回调 onDone（浮层借此关闭）。
 */
export const ThoughtComposer = observer(function ThoughtComposer({
  documentId,
  slot,
  autoFocus = false,
  onDone,
}: {
  documentId: string;
  /** rail 常驻栏和 float 浮层各记各的草稿。 */
  slot: 'rail' | 'float';
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const service = useService(DocsService);
  const [boundId, setBoundId] = useState(documentId);
  const [note, setNote] = useState(() => thoughtDraftFor(slot, documentId).note);
  const [image, setImage] = useState(() => thoughtDraftFor(slot, documentId).image);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef(note);
  const imageRef = useRef(image);
  const boundRef = useRef(documentId);
  const revisionRef = useRef(thoughtDraftRevision(slot, documentId));
  noteRef.current = note;
  imageRef.current = image;
  boundRef.current = boundId;

  if (boundId !== documentId) {
    putThoughtDraft(slot, boundId, { note, image });
    const next = thoughtDraftFor(slot, documentId);
    revisionRef.current = thoughtDraftRevision(slot, documentId);
    setBoundId(documentId);
    setNote(next.note);
    setImage(next.image);
  }

  const remember = (nextNote: string, nextImage: { key: string; preview: string } | null) => {
    revisionRef.current = putThoughtDraft(slot, documentId, { note: nextNote, image: nextImage });
  };

  useEffect(() => {
    return () => {
      const id = boundRef.current;
      if (thoughtDraftRevision(slot, id) !== revisionRef.current) return;
      putThoughtDraft(slot, id, { note: noteRef.current, image: imageRef.current });
    };
  }, [slot]);

  const pick = async (file: File) => {
    if (busy) return;
    setBusy(true);
    const key = await service.uploadThoughtImage(file);
    setBusy(false);
    if (!key) return;
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.preview);
    const next = { key, preview: URL.createObjectURL(file) };
    setImage(next);
    remember(note, next);
  };

  const removeImage = () => {
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
    remember(note, null);
  };

  const submit = async () => {
    if (busy) return;
    const text = note.trim();
    if (!text && !image) return;
    setBusy(true);
    const anchor = service.thoughtAnchorBlockIndex();
    const created = await service.addThought({
      documentId,
      note: text,
      ...(image ? { imageKey: image.key } : {}),
      ...(anchor != null ? { anchorBlockIndex: anchor } : {}),
    });
    setBusy(false);
    if (!created) return;
    setNote('');
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
    remember('', null);
    onDone?.();
  };

  return (
    <div className="thought-box">
      <textarea
        rows={3}
        autoFocus={autoFocus}
        placeholder="记一条想法…"
        value={note}
        maxLength={20_000}
        onChange={(event) => {
          const next = event.target.value;
          setNote(next);
          remember(next, image);
        }}
        onKeyDown={(event) => {
          if (imeBlocksEnterFromEvent(event.nativeEvent)) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {image ? (
        <div className="thought-thumb">
          <img src={image.preview} alt="贴图预览" />
          <button
            type="button"
            className="thought-thumb-remove"
            aria-label="移除贴图"
            onClick={removeImage}
          >
            <X width={12} height={12} strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="thought-actions">
        <Tip content="贴一张图">
        <button
          type="button"
          className="btn btn-ghost thought-attach"
          aria-label="贴一张图"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus width={14} height={14} strokeWidth={1.8} />
        </button>
        </Tip>
        <span className="card-rail-spring" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (!note.trim() && !image)}
          onClick={() => void submit()}
        >
          {busy ? '保存中…' : '记下'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void pick(file);
        }}
      />
    </div>
  );
});
