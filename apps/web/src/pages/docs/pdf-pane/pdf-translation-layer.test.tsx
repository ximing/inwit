// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  pdf: { selectionText: '' },
  translation: {
    documentId: 'doc',
    enabled: true,
    pages: {} as Record<number, unknown>,
    target: null,
    pageErrors: {},
    watchPage: vi.fn(),
    unwatchPage: vi.fn(),
    openSegment: vi.fn(),
  },
}));
vi.mock('../pdf-pane.service.js', () => ({ PdfPaneService: class PdfPaneService {} }));
vi.mock('./pdf-translation.service.js', () => ({
  PdfTranslationService: class PdfTranslationService {},
}));
vi.mock('@rabjs/react', () => ({
  observer: (component: unknown) => component,
  useService: (type: { name: string }) =>
    type.name === 'PdfPaneService' ? mock.pdf : mock.translation,
}));
vi.mock('@embedpdf/core/react', () => ({
  useDocumentState: () => ({
    document: { pages: [{ size: { width: 100, height: 100 } }] },
    scale: 1,
  }),
}));
vi.mock('@embedpdf/plugin-capture/react', () => ({
  useCapture: () => ({ state: { isMarqueeCaptureActive: false } }),
}));
import { PdfTranslationLayer } from './pdf-translation-layer.js';
let root: Root, host: HTMLDivElement, line: HTMLElement, action: HTMLButtonElement;
function event(target: HTMLElement, name: string, x: number, y: number, detail = 1) {
  target.dispatchEvent(
    name.startsWith('pointer')
      ? new PointerEvent(name, { bubbles: true, clientX: x, clientY: y })
      : new MouseEvent(name, { bubbles: true, clientX: x, clientY: y, detail }),
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.pdf.selectionText = '';
  mock.translation.pages = {
    0: {
      state: 'ready',
      geometry: {
        coordinateVersion: 'crop-local-points-v1',
        cropBox: [0, 0, 100, 100],
        width: 100,
        height: 100,
        userUnit: 1,
        intrinsicRotation: 0,
      },
      segments: [
        {
          id: 'segment',
          pageIndex: 0,
          sourceText: 'paragraph',
          qualityState: 'reliable',
          rects: [
            [
              { x: 10, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 40 },
              { x: 10, y: 40 },
            ],
          ],
        },
      ],
    },
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<PdfTranslationLayer documentId="doc" pageIndex={0} />));
  line = host.querySelector('[data-pdf-segment]')!;
  action = host.querySelector('[data-pdf-translation-action]')!;
  line.getBoundingClientRect = () => ({ left: 10, right: 90, top: 50, bottom: 60 }) as DOMRect;
  action.getBoundingClientRect = () => ({ left: 10, right: 64, top: 28, bottom: 46 }) as DOMRect;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
describe('paragraph hover action', () => {
  it('hides hover during selection, dragging and toolbar interaction', async () => {
    event(host, 'pointermove', 20, 55);
    mock.pdf.selectionText = 'selected text';
    document.dispatchEvent(new Event('selectionchange'));
    expect(action.classList.contains('is-hover')).toBe(false);
    event(host, 'pointermove', 20, 55);
    expect(action.classList.contains('is-hover')).toBe(false);
    mock.pdf.selectionText = '';
    event(host, 'pointermove', 20, 55);
    event(host, 'pointerdown', 20, 55);
    event(host, 'pointermove', 40, 55);
    expect(action.classList.contains('is-hover')).toBe(false);
    event(host, 'pointerup', 40, 55);
    event(host, 'pointermove', 20, 55);
    expect(action.classList.contains('is-hover')).toBe(true);
    const toolbar = document.createElement('div');
    toolbar.className = 'float-toolbar';
    const tool = document.createElement('button');
    toolbar.append(tool);
    host.append(toolbar);
    event(tool, 'pointermove', 20, 55);
    expect(action.classList.contains('is-hover')).toBe(false);
    event(host, 'pointermove', 20, 55);
    tool.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(action.classList.contains('is-hover')).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(mock.translation.openSegment).not.toHaveBeenCalled();
    toolbar.remove();
  });
  it('clears stale hover when SDK selection updates without a native selection event', async () => {
    event(host, 'pointermove', 20, 55);
    mock.pdf.selectionText = 'SDK selection';
    await act(async () => root.render(<PdfTranslationLayer documentId="doc" pageIndex={0} />));
    expect(action.classList.contains('is-hover')).toBe(false);
    expect(host.querySelector('.pdf-translation-layer.is-selecting')).not.toBeNull();
  });
  it('keeps the action visible while crossing the gap and activates after arbitration', async () => {
    event(host, 'pointermove', 20, 55);
    expect(action.classList.contains('is-hover')).toBe(true);
    event(host, 'pointermove', 20, 48);
    expect(action.classList.contains('is-hover')).toBe(true);
    event(action, 'pointermove', 20, 35);
    expect(action.classList.contains('is-hover')).toBe(true);
    event(action, 'pointerdown', 20, 35);
    event(action, 'click', 20, 35);
    event(host, 'pointermove', 40, 55);
    await vi.advanceTimersByTimeAsync(399);
    expect(mock.translation.openSegment).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.translation.openSegment).toHaveBeenCalledTimes(1);
  });
  it('does not translate double clicks, drags, or the first click clearing selection', async () => {
    event(host, 'pointermove', 20, 55);
    event(action, 'pointerdown', 20, 35);
    event(action, 'click', 20, 35);
    event(action, 'pointerdown', 20, 35);
    event(action, 'click', 20, 35, 2);
    event(action, 'dblclick', 20, 35, 2);
    await vi.advanceTimersByTimeAsync(500);
    expect(mock.translation.openSegment).not.toHaveBeenCalled();
    event(host, 'pointerdown', 20, 55);
    event(host, 'pointermove', 40, 55);
    event(host, 'click', 40, 55);
    await vi.advanceTimersByTimeAsync(500);
    expect(mock.translation.openSegment).not.toHaveBeenCalled();
    mock.pdf.selectionText = 'selected';
    event(action, 'pointerdown', 20, 35);
    mock.pdf.selectionText = '';
    event(action, 'click', 20, 35);
    await vi.advanceTimersByTimeAsync(500);
    expect(mock.translation.openSegment).not.toHaveBeenCalled();
  });
  it('clears hover outside the action and real line bounds', () => {
    event(host, 'pointermove', 20, 55);
    event(host, 'pointermove', 95, 48);
    expect(action.classList.contains('is-hover')).toBe(false);
    event(host, 'pointermove', 20, 55);
    event(host, 'pointerleave', 110, 55);
    expect(action.classList.contains('is-hover')).toBe(false);
  });
});
