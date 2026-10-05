import { observer, useService } from '@rabjs/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DocsService } from './docs.service';
import { ThoughtComposer } from './thought-composer';

/**
 * 记想法浮动输入框（工具栏按钮 / 快捷键 n 唤起）。
 * 样式沿用 .sel-pop 的浮层骨架；Esc / 点击外部关闭，禁用 window.prompt。
 */
export const ThoughtPop = observer(function ThoughtPop() {
  const service = useService(DocsService);
  const pop = service.thoughtPop;
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!pop) return;
    const el = boxRef.current;
    const width = el?.offsetWidth ?? 300;
    const height = el?.offsetHeight ?? 180;
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
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.sel-pop, .float-toolbar')) return;
      service.closeThoughtPop();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pop, service]);

  if (!pop || !service.doc) return null;

  return createPortal(
    <div
      ref={boxRef}
      className="sel-pop thought-pop"
      role="dialog"
      aria-label="记一条想法"
      style={{ left: pos.left, top: pos.top }}
    >
      <ThoughtComposer
        documentId={service.doc.id}
        autoFocus
        onDone={() => service.closeThoughtPop()}
      />
    </div>,
    document.body,
  );
});
