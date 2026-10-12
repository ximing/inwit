import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { ClozeText } from '@/components/reader/mini-card';
import { Tip } from '@/components/tip';
import type { LinksPanelAnchor } from './mindmap-focus';
import { elementIsClamped } from './mindmap-readout';

const CLAMPED = '.mini-q, .canvas-node-quote, .canvas-node-note, .canvas-node-text';

/** line-clamp 有时把 scrollHeight 报成截断后的高度，再用一份去掉截断的副本核对。 */
function visuallyClamped(node: HTMLElement): boolean {
  if (elementIsClamped(node)) return true;
  const clone = node.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return false;
  const style = getComputedStyle(node);
  clone.style.position = 'fixed';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.style.boxSizing = 'border-box';
  clone.style.width = `${node.offsetWidth}px`;
  clone.style.display = style.display;
  clone.style.webkitBoxOrient = style.webkitBoxOrient;
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  clone.style.webkitLineClamp = 'unset';
  clone.style.font = style.font;
  clone.style.letterSpacing = style.letterSpacing;
  clone.style.whiteSpace = style.whiteSpace;
  clone.style.padding = style.padding;
  document.body.appendChild(clone);
  const full = clone.offsetHeight;
  clone.remove();
  // 去掉截断后至少高出一行，才当成被折叠。避免盒模型差一两像素误报。
  return full > node.offsetHeight + 8;
}

/**
 * 挂在节点里测可见文字有没有被行数截断。右上角图标绝对定位，不改节点高度。
 * 卡片还有没画出来的答案时，hiddenBody 为真，不等测量也显示。
 */
export function ReadoutToggle({
  hiddenBody,
  watch,
  open,
  zoom,
  onToggle,
}: {
  hiddenBody: boolean;
  watch: string;
  open: boolean;
  zoom: number;
  onToggle: () => void;
}) {
  const probe = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const host = probe.current?.parentElement;
    if (!host || hiddenBody) return;
    const measure = () => {
      let next = false;
      for (const node of host.querySelectorAll(CLAMPED)) {
        if (node instanceof HTMLElement && visuallyClamped(node)) {
          next = true;
          break;
        }
      }
      setClamped(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const node of host.querySelectorAll(CLAMPED)) observer.observe(node);
    return () => observer.disconnect();
  }, [watch, hiddenBody]);

  const show = hiddenBody || clamped;
  return (
    <>
      <span ref={probe} hidden />
      {show ? (
        <Tip content={open ? '关闭全文' : '查看全文'} side="left">
          <button
            type="button"
            className={`canvas-readout-toggle${open ? ' is-on' : ''}`}
            aria-expanded={open}
            aria-label={open ? '关闭全文' : '查看全文'}
            style={{ transform: `scale(${1 / (zoom || 1)})` }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              // 双击会连发两次 click。第二次丢掉，避免刚打开又合上。
              if (event.detail > 1) return;
              onToggle();
            }}
          >
            {open ? (
              <Minimize2 width={13} height={13} strokeWidth={1.8} />
            ) : (
              <Maximize2 width={13} height={13} strokeWidth={1.8} />
            )}
          </button>
        </Tip>
      ) : null}
    </>
  );
}

export type MindReadout =
  | {
      kind: 'card';
      concept: string;
      example: string;
      confusionPoint: string;
      questions: readonly { question: string; answer: string }[];
    }
  | { kind: 'annotation'; quote: string; note: string }
  | { kind: 'text'; text: string };

const KIND_LABEL = { card: '卡片', annotation: '批注', text: '文本' } as const;

function readable(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed === IMAGE_EXCERPT_QUOTE) return '';
  return text;
}

/**
 * 只读全文。屏幕坐标锚在节点旁，不参与脑图布局。
 */
export function CanvasReadout({
  content,
  anchor,
  width,
  maxHeight,
  onClose,
  onEdit,
}: {
  content: MindReadout;
  anchor: LinksPanelAnchor;
  width: number;
  maxHeight: number;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="canvas-readout"
      role="dialog"
      aria-label="全文"
      style={{ left: anchor.left, top: anchor.top, width, maxHeight }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="canvas-readout-head">
        <span>全文 · {KIND_LABEL[content.kind]}</span>
        <button type="button" aria-label="关闭全文" onClick={onClose}>
          <X width={13} height={13} strokeWidth={1.8} />
        </button>
      </div>
      <div className="canvas-readout-body">
        {content.kind === 'card' ? <CardBody content={content} /> : null}
        {content.kind === 'annotation' ? (
          <>
            {readable(content.quote) ? (
              <>
                <p className="canvas-readout-kicker">摘录</p>
                <p className="canvas-readout-text">{content.quote}</p>
              </>
            ) : null}
            {readable(content.note) ? (
              <>
                <p className="canvas-readout-kicker">想法</p>
                <p className="canvas-readout-text">{content.note}</p>
              </>
            ) : null}
          </>
        ) : null}
        {content.kind === 'text' ? <p className="canvas-readout-text">{content.text}</p> : null}
      </div>
      <div className="canvas-readout-foot">
        <button type="button" onClick={onEdit}>
          编辑
        </button>
      </div>
    </div>
  );
}

function CardBody({ content }: { content: Extract<MindReadout, { kind: 'card' }> }) {
  const concept = readable(content.concept);
  const example = readable(content.example);
  const confusion = readable(content.confusionPoint);
  const many = content.questions.length > 1;
  return (
    <>
      {concept ? (
        <>
          <p className="canvas-readout-kicker">概念</p>
          <p className="canvas-readout-text">
            <ClozeText text={concept} />
          </p>
        </>
      ) : null}
      {example ? (
        <>
          <p className="canvas-readout-kicker">例子</p>
          <p className="canvas-readout-text">
            <ClozeText text={example} />
          </p>
        </>
      ) : null}
      {confusion ? (
        <>
          <p className="canvas-readout-kicker">易混点</p>
          <p className="canvas-readout-text">{confusion}</p>
        </>
      ) : null}
      {content.questions.map((item, index) => {
        const question = readable(item.question);
        const answer = readable(item.answer);
        const repeat = !many && question.trim() === concept.trim();
        if ((!question || repeat) && !answer) return null;
        const mark = many ? ` ${index + 1}` : '';
        return (
          <div key={index}>
            {question && !repeat ? (
              <>
                <p className="canvas-readout-kicker">问题{mark}</p>
                <p className="canvas-readout-text">
                  <ClozeText text={question} />
                </p>
              </>
            ) : null}
            {answer ? (
              <>
                <p className="canvas-readout-kicker">答案{mark}</p>
                <p className="canvas-readout-text">
                  <ClozeText text={answer} />
                </p>
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
