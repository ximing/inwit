import { loadNativeWindow } from '@/platform/native';
import { isTauriRuntime } from '@/platform/runtime';

export type NativeDueBadgeKind = 'count' | 'overlay';

export type NativeDueBadgeHandle = {
  setBadgeCount(count?: number): Promise<void>;
  setOverlayIcon(icon?: Uint8Array): Promise<void>;
};

export type NativeDueBadgeDeps = {
  isTauri?: () => boolean;
  platform?: () => NativeDueBadgeKind;
  loadWindow?: () => Promise<NativeDueBadgeHandle>;
  renderOverlay?: (count: number) => Promise<Uint8Array>;
};

let generation = 0;
let queue: Promise<void> = Promise.resolve();

/** Windows taskbar uses an overlay icon. macOS Dock and Linux use the numeric badge. */
export function dueBadgeKind(userAgent: string): NativeDueBadgeKind {
  return /Windows/i.test(userAgent) ? 'overlay' : 'count';
}

export function shownDueCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.trunc(count));
}

function defaultIsTauri(): boolean {
  return isTauriRuntime();
}

function defaultKind(): NativeDueBadgeKind {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return dueBadgeKind(ua);
}

async function defaultLoadWindow(): Promise<NativeDueBadgeHandle> {
  const win = await loadNativeWindow();
  if (!win) throw new Error('native window unavailable');
  return win;
}

/** 32px red disc. Windows scales it into the taskbar overlay slot. */
export async function renderDueOverlayPng(count: number): Promise<Uint8Array> {
  const shown = shownDueCount(count);
  const label = shown > 99 ? '99+' : String(shown);
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#E23B2F';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  const fontSize = label.length >= 3 ? 11 : label.length === 2 ? 14 : 18;
  ctx.font = `700 ${fontSize}px ui-sans-serif, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 0.5);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png');
  });
  if (!blob) throw new Error('png');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Push the pending-review count onto the desktop app icon.
 * Zero clears the badge. Outside Tauri this is a no-op.
 */
export function syncNativeDueBadge(count: number, deps: NativeDueBadgeDeps = {}): Promise<void> {
  const shown = shownDueCount(count);
  const token = ++generation;
  const run = async (): Promise<void> => {
    if (token !== generation) return;
    const isTauri = deps.isTauri ?? defaultIsTauri;
    if (!isTauri()) return;
    try {
      const load = deps.loadWindow ?? defaultLoadWindow;
      const win = await load();
      if (token !== generation) return;
      const kind = (deps.platform ?? defaultKind)();
      if (kind === 'overlay') {
        if (shown === 0) {
          await win.setOverlayIcon(undefined);
          return;
        }
        const render = deps.renderOverlay ?? renderDueOverlayPng;
        const png = await render(shown);
        if (token !== generation) return;
        await win.setOverlayIcon(png);
        return;
      }
      await win.setBadgeCount(shown > 0 ? shown : undefined);
    } catch {
      // Browser, missing permission, or a platform that rejects the call.
    }
  };
  queue = queue.then(run, run);
  return queue;
}

export function resetNativeDueBadgeSyncForTests(): void {
  generation = 0;
  queue = Promise.resolve();
}
