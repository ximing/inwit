import { observer, useService } from '@rabjs/react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  DOC_LIST_WIDTH_DEFAULT,
  DOC_LIST_WIDTH_MAX,
  DOC_LIST_WIDTH_MIN,
  docListWidthFromDrag,
  docListWidthFromKey,
} from '@/services/ui-prefs-logic';
import { UiPrefsService } from '@/services/ui-prefs.service';

/** 文档列表右缘的拖拽手柄；交互与卡片栏 resizer 保持一致。 */
export const DocListResizer = observer(function DocListResizer() {
  const prefs = useService(UiPrefsService);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const stopResize = () => {
    dragRef.current = null;
    document.documentElement.classList.remove('is-resizing-doc-list');
  };

  useEffect(() => {
    return () => stopResize();
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = prefs.docListWidth;
    dragRef.current = { startX, startWidth };
    document.documentElement.classList.add('is-resizing-doc-list');

    const onMove = (move: globalThis.PointerEvent) => {
      if (!dragRef.current) return;
      prefs.setDocListWidth(docListWidthFromDrag(startWidth, startX, move.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopResize();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = docListWidthFromKey(prefs.docListWidth, event.key);
    if (next == null) return;
    event.preventDefault();
    prefs.setDocListWidth(next);
  };

  return (
    <div
      className="doc-list-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整文档列表宽度"
      aria-valuemin={DOC_LIST_WIDTH_MIN}
      aria-valuemax={DOC_LIST_WIDTH_MAX}
      aria-valuenow={prefs.docListWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => prefs.setDocListWidth(DOC_LIST_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
});
