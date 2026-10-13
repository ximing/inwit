import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import {
  imageLengthPx,
  MIN_IMAGE_WIDTH_PX,
  nextImageSize,
  type ImageResizeCorner,
} from './image-resize.js';

export type ImageAssetSource = {
  urlFor: (src: string) => string | null;
  ensure: (srcs: string[]) => void;
  subscribe: (listener: () => void) => () => void;
};

const CORNERS: readonly ImageResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

const CORNER_CURSOR: Record<ImageResizeCorner, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

const CORNER_LABEL: Record<ImageResizeCorner, string> = {
  nw: '从左上角调整图片大小',
  ne: '从右上角调整图片大小',
  sw: '从左下角调整图片大小',
  se: '从右下角调整图片大小',
};

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  corner: ImageResizeCorner;
  moved: boolean;
  width: number;
  height: number;
};

function readPos(getPos: NodeViewRendererProps['getPos']): number | null {
  if (typeof getPos !== 'function') return null;
  const pos = getPos();
  return typeof pos === 'number' ? pos : null;
}

function attrString(node: ProseMirrorNode, key: string): string {
  const value = node.attrs[key];
  return typeof value === 'string' ? value : '';
}

/** Content box of the parent block, so a resized picture cannot paint past the column. */
function contentBoxWidth(parent: HTMLElement | null): number | null {
  if (!parent) return null;
  const style = getComputedStyle(parent);
  const pad =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return Math.max(1, parent.clientWidth - pad);
}

function imageNodeView(assets: ImageAssetSource): NodeViewRenderer {
  return ({ node, editor, getPos }: NodeViewRendererProps): NodeView => {
    let current = node;
    let drag: Drag | null = null;
    let observer: ResizeObserver | null = null;
    let observed: Element | null = null;

    const frame = document.createElement('span');
    frame.className = 'doc-image-frame';
    frame.contentEditable = 'false';

    const img = document.createElement('img');
    img.className = 'doc-image';
    img.draggable = false;
    frame.append(img);

    for (const corner of CORNERS) {
      const handle = document.createElement('span');
      handle.className = 'doc-image-resize';
      handle.dataset.dir = corner;
      handle.setAttribute('role', 'presentation');
      handle.setAttribute('aria-label', CORNER_LABEL[corner]);
      handle.title = '拖拽调整大小';
      handle.addEventListener('pointerdown', (event) => onPointerDown(event, corner));
      frame.append(handle);
    }

    const capNatural = (): void => {
      if (frame.classList.contains('is-sized') || frame.classList.contains('is-resizing')) {
        img.style.removeProperty('max-width');
        return;
      }
      // A percentage max-width cycles inside this shrink-wrapped frame, so cap with pixels.
      const max = contentBoxWidth(frame.parentElement);
      if (max == null) return;
      img.style.maxWidth = `${Math.floor(max)}px`;
    };

    const applySize = (): void => {
      const width = imageLengthPx(current.attrs.width);
      const height = imageLengthPx(current.attrs.height);
      const sized = width != null && height != null;
      frame.classList.toggle('is-sized', sized);
      if (sized) {
        frame.style.width = `${width}px`;
        frame.style.aspectRatio = `${width} / ${height}`;
        img.style.removeProperty('max-width');
        return;
      }
      frame.style.removeProperty('width');
      frame.style.removeProperty('aspect-ratio');
      capNatural();
    };

    const syncEditable = (): void => {
      frame.classList.toggle('is-editable', editor.isEditable);
    };

    const sync = (): void => {
      const src = attrString(current, 'src');
      const alt = attrString(current, 'alt');
      const title = attrString(current, 'title');
      if (alt) img.alt = alt;
      else img.removeAttribute('alt');
      if (title) img.title = title;
      else img.removeAttribute('title');

      const url = src ? assets.urlFor(src) : null;
      if (url) {
        if (img.getAttribute('src') !== url) img.src = url;
        img.classList.remove('doc-image-pending');
      } else {
        if (img.hasAttribute('src')) img.removeAttribute('src');
        img.classList.add('doc-image-pending');
      }
      if (src) void assets.ensure([src]);
      syncEditable();
      if (!frame.classList.contains('is-resizing')) applySize();
    };

    const watchParent = (): void => {
      const parent = frame.parentElement;
      if (!parent || parent === observed) {
        capNatural();
        return;
      }
      observer?.disconnect();
      observer = new ResizeObserver(() => {
        if (!frame.classList.contains('is-resizing')) capNatural();
      });
      observer.observe(parent);
      observed = parent;
      capNatural();
    };

    const clearCursor = (): void => {
      document.documentElement.classList.remove('doc-image-resizing');
      document.documentElement.style.removeProperty('--doc-image-resize-cursor');
    };

    const detachDrag = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    const commit = (width: number, height: number): void => {
      const pos = readPos(getPos);
      if (pos == null || editor.isDestroyed) return;
      const storedWidth = imageLengthPx(current.attrs.width);
      const storedHeight = imageLengthPx(current.attrs.height);
      if (storedWidth === width && storedHeight === height) return;
      const currentNode = editor.state.doc.nodeAt(pos);
      if (!currentNode || currentNode.type.name !== 'image') return;
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        width,
        height,
      });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      editor.view.dispatch(tr);
    };

    function onPointerMove(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const max = contentBoxWidth(frame.parentElement) ?? drag.startWidth;
      const next = nextImageSize({
        startWidth: drag.startWidth,
        startHeight: drag.startHeight,
        deltaX: event.clientX - drag.startX,
        deltaY: event.clientY - drag.startY,
        corner: drag.corner,
        minWidth: Math.min(MIN_IMAGE_WIDTH_PX, drag.startWidth),
        maxWidth: max,
      });
      drag.moved = true;
      drag.width = next.width;
      drag.height = next.height;
      frame.style.width = `${next.width}px`;
      frame.style.aspectRatio = `${drag.startWidth} / ${drag.startHeight}`;
      frame.classList.add('is-sized');
    }

    function onPointerUp(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const finished = drag;
      drag = null;
      frame.classList.remove('is-resizing');
      clearCursor();
      detachDrag();
      if (!finished.moved) {
        applySize();
        return;
      }
      commit(finished.width, finished.height);
      if (!frame.isConnected) return;
      if (imageLengthPx(current.attrs.width) !== finished.width) applySize();
    }

    function onPointerDown(event: PointerEvent, corner: ImageResizeCorner): void {
      if (!editor.isEditable || drag || event.button !== 0) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      event.preventDefault();
      event.stopPropagation();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        corner,
        moved: false,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      frame.classList.add('is-resizing');
      document.documentElement.style.setProperty('--doc-image-resize-cursor', CORNER_CURSOR[corner]);
      document.documentElement.classList.add('doc-image-resizing');
      const target = event.currentTarget;
      if (target instanceof HTMLElement && target.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone. Window listeners still finish the drag.
        }
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    }

    const onEditor = (): void => {
      syncEditable();
    };
    const unsub = assets.subscribe(sync);
    editor.on('update', onEditor);
    sync();
    queueMicrotask(watchParent);

    return {
      dom: frame,
      update: (updated) => {
        if (updated.type !== current.type) return false;
        current = updated;
        sync();
        watchParent();
        return true;
      },
      destroy: () => {
        drag = null;
        clearCursor();
        detachDrag();
        observer?.disconnect();
        observer = null;
        observed = null;
        unsub();
        editor.off('update', onEditor);
      },
      ignoreMutation: () => true,
      stopEvent: (event) => {
        const target = event.target;
        return target instanceof Element && target.classList.contains('doc-image-resize');
      },
    };
  };
}

/** Inline document image. Corner handles resize it without changing the aspect ratio. */
export function createDocImage(assets: ImageAssetSource) {
  return Image.extend({
    atom: true,
    addNodeView() {
      return imageNodeView(assets);
    },
  }).configure({
    inline: true,
    allowBase64: false,
  });
}
