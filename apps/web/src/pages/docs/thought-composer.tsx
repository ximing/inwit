import { observer, useService } from '@rabjs/react';
import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tip } from '@/components/tip';
import { DocsService } from './docs.service';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * 记一条想法的输入区：文字 + 可选贴图。批注栏顶部常驻与浮动输入框共用。
 * 提交后清空并回调 onDone（浮层借此关闭）。
 */
export const ThoughtComposer = observer(function ThoughtComposer({
  documentId,
  autoFocus = false,
  onDone,
}: {
  documentId: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const service = useService(DocsService);
  const [note, setNote] = useState('');
  const [image, setImage] = useState<{ key: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<{ key: string; preview: string } | null>(null);
  imageRef.current = image;

  useEffect(() => {
    return () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.preview);
    };
  }, []);

  const pick = async (file: File) => {
    if (busy) return;
    setBusy(true);
    const key = await service.uploadThoughtImage(file);
    setBusy(false);
    if (!key) return;
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.preview);
    setImage({ key, preview: URL.createObjectURL(file) });
  };

  const removeImage = () => {
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
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
    removeImage();
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
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
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
