import { IMAGE_EXCERPT_QUOTE, type AnnotationGeometry } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Copy, Highlighter, Sparkles, SquarePlus } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { TextSelectionAnchor } from '@/lib/entity-marks';
import { DocsService } from './docs.service';

export type SelRect = { left: number; top: number; bottom: number };

function clip(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join('');
}

function ToolIcon({
  label,
  disabled,
  wide,
  onAction,
  children,
}: {
  label: string;
  disabled?: boolean;
  wide?: boolean;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`float-tool${wide ? ' is-wide' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (disabled) return;
        onAction();
      }}
    >
      {children}
    </button>
  );
}

export const SelectionActions = observer(function SelectionActions({
  text,
  documentId,
  getRect,
  getSelection,
  blockIndex,
  pdf,
}: {
  text: string;
  documentId: string | null;
  getRect: () => SelRect;
  getSelection?: () => TextSelectionAnchor | null;
  blockIndex?: number;
  pdf?: {
    pageIndex: number;
    geometry: AnnotationGeometry;
    imageKey?: string;
  };
}) {
  const service = useService(DocsService);
  const digesting = service.selectionDigesting;
  const locked = !documentId;

  const resolveAnchor = (): { blockIndex?: number; from?: number; to?: number } => {
    const sel = getSelection?.();
    if (sel) return { blockIndex: sel.blockIndex, from: sel.from, to: sel.to };
    if (blockIndex != null) return { blockIndex };
    return {};
  };

  const openPop = (kind: 'annotate' | 'card') => {
    if (!documentId) return;
    const rect = getRect();
    const anchor = resolveAnchor();
    service.openSelectionPop({
      kind,
      text,
      left: rect.left,
      top: rect.bottom,
      documentId,
      ...anchor,
      ...(pdf ? { pdf } : {}),
    });
  };

  const runAi = () => {
    if (!documentId || digesting) return;
    const index = resolveAnchor().blockIndex;
    if (index == null) return;
    void service.queueSelectionCards(documentId, clip(text, 100_000), index);
  };

  return (
    <>
      <ToolIcon label="复制" onAction={() => void navigator.clipboard.writeText(text)}>
        <Copy width={15} height={15} strokeWidth={2} />
      </ToolIcon>
      <ToolIcon
        label={locked ? '保存后再批注' : '划线批注'}
        disabled={locked}
        onAction={() => openPop('annotate')}
      >
        <Highlighter width={15} height={15} strokeWidth={2} />
      </ToolIcon>
      <ToolIcon
        label={locked ? '保存后再写卡' : '写卡片'}
        disabled={locked}
        onAction={() => openPop('card')}
      >
        <SquarePlus width={15} height={15} strokeWidth={2} />
      </ToolIcon>
      <ToolIcon
        label={locked ? '保存后再写卡' : digesting ? '消化中…' : 'AI 写卡'}
        disabled={locked || digesting}
        wide={digesting}
        onAction={runAi}
      >
        {digesting ? '消化中…' : <Sparkles width={15} height={15} strokeWidth={2} />}
      </ToolIcon>
    </>
  );
});

export const SelectionPopoverHost = observer(function SelectionPopoverHost() {
  const service = useService(DocsService);
  const pop = service.selectionPop;
  const [note, setNote] = useState('');
  const [concept, setConcept] = useState('');
  const [example, setExample] = useState('');
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 12, top: 12 });

  useEffect(() => {
    if (!pop) {
      setNote('');
      setConcept('');
      setExample('');
      setSaving(false);
      return;
    }
    setNote('');
    setConcept('');
    setExample(pop.text);
    setSaving(false);
  }, [pop]);

  useLayoutEffect(() => {
    if (!pop) return;
    const el = boxRef.current;
    const width = el?.offsetWidth ?? 280;
    const height = el?.offsetHeight ?? 160;
    const pad = 12;
    let left = pop.left - width / 2;
    let top = pop.top + 10;
    left = Math.min(Math.max(pad, left), window.innerWidth - width - pad);
    if (top + height > window.innerHeight - pad && pop.top - height - 24 > pad) {
      top = pop.top - height - 36;
    }
    setPos({ left, top });
  }, [pop]);

  useEffect(() => {
    if (!pop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      service.closeSelectionPop();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.sel-pop, .float-toolbar')) return;
      service.closeSelectionPop();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [pop, service]);

  if (!pop) return null;

  const saveAnnotate = async () => {
    if (saving) return;
    setSaving(true);
    const extra = pop.pdf
      ? {
          kind: 'pdf' as const,
          pageIndex: pop.pdf.pageIndex,
          geometry: pop.pdf.geometry,
          ...(pop.pdf.imageKey ? { imageKey: pop.pdf.imageKey } : {}),
        }
      : {
          ...(pop.blockIndex != null ? { anchorBlockIndex: pop.blockIndex } : {}),
          ...(pop.from != null && pop.to != null ? { from: pop.from, to: pop.to } : {}),
        };
    const ok = await service.addAnnotation(pop.documentId, clip(pop.text, 20_000), note, extra);
    setSaving(false);
    if (ok) service.closeSelectionPop();
  };

  const saveCard = async () => {
    if (saving) return;
    const q = concept.trim();
    if (!q) return;
    setSaving(true);
    const pdf = pop.pdf;
    const imageKey = pdf?.imageKey;
    const ok = await service.addManualCard({
      documentId: pop.documentId,
      concept: clip(q, 2000),
      example: clip(example, 4000),
      ...(imageKey && pdf
        ? {
            imageKey,
            anchorText: IMAGE_EXCERPT_QUOTE,
          }
        : {
            anchorText: clip(pop.text, 4000),
            ...(pop.blockIndex != null ? { anchorBlockIndex: pop.blockIndex } : {}),
          }),
    });
    setSaving(false);
    if (ok) service.closeSelectionPop();
  };

  return createPortal(
    <div
      ref={boxRef}
      className="sel-pop"
      role="dialog"
      aria-label={pop.kind === 'annotate' ? '划线批注' : '写卡片'}
      style={{ left: pos.left, top: pos.top }}
    >
      <p className="sel-pop-quote">{pop.text}</p>
      {pop.kind === 'annotate' ? (
        <>
          <textarea
            autoFocus
            rows={3}
            placeholder="我的想法…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={20_000}
          />
          <div className="sel-pop-actions">
            <button type="button" className="btn btn-ghost" onClick={() => service.closeSelectionPop()}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void saveAnnotate()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            autoFocus
            placeholder="问题"
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            maxLength={2000}
          />
          <textarea
            rows={4}
            placeholder="答案"
            value={example}
            onChange={(event) => setExample(event.target.value)}
            maxLength={4000}
          />
          <div className="sel-pop-actions">
            <button type="button" className="btn btn-ghost" onClick={() => service.closeSelectionPop()}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || concept.trim().length === 0}
              onClick={() => void saveCard()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
});

export const ReadSelectionToolbar = observer(function ReadSelectionToolbar() {
  const service = useService(DocsService);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    bottom: number;
    text: string;
  } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const holdRef = useRef(false);

  useEffect(() => {
    const hide = () => {
      if (holdRef.current) return;
      if (service.selectionPop) return;
      if (service.selectionDigesting && posRef.current) return;
      setPos(null);
    };
    const update = () => {
      if (holdRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hide();
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        hide();
        return;
      }
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el?.closest('.pane-doc:not(.is-editing) .paper')) {
        hide();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }
      setPos({
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        text,
      });
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', hide, true);
    };
  }, [service]);

  useEffect(() => {
    if (service.selectionPop) {
      setPos(null);
      return;
    }
    if (service.selectionDigesting) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) setPos(null);
  }, [service.selectionPop, service.selectionDigesting]);

  if (!pos) return null;

  return createPortal(
    <div
      className="float-toolbar"
      role="toolbar"
      aria-label="划线工具"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, calc(-100% - 12px))',
      }}
      onMouseEnter={() => {
        holdRef.current = true;
      }}
      onMouseLeave={() => {
        holdRef.current = false;
      }}
    >
      <SelectionActions
        text={pos.text}
        documentId={service.doc?.id ?? null}
        getSelection={() => service.editorHost?.selectionAnchor() ?? null}
        getRect={() => ({ left: pos.left, top: pos.top, bottom: pos.bottom })}
      />
    </div>,
    document.body,
  );
});
