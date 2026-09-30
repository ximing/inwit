import { Service } from '@rabjs/react';
import type { SyncChange, SyncPollResponse } from '@inwit/dto';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { ApiError, request } from '@/api/client';
import { nextPollDelayMs } from '@/lib/sync-plan';

/** One `more: true` burst, then the normal delay. Each page advances the cursor. */
const SYNC_BURST_PAGES = 5;

export type SyncEvent =
  | { type: 'changes'; changes: SyncChange[] }
  | { type: 'reset' }
  | { type: 'active'; active: boolean };

type SyncListener = (event: SyncEvent) => void;

export class SyncService extends Service {
  /** Handshake succeeded and the shell has not degraded. Pages use this to skip old timers. */
  active = false;
  cursor: string | null = null;

  private listeners: SyncListener[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedDelay: number | null = null;
  private inflight = false;
  private failures = 0;
  private degraded = false;
  private stopped = false;
  private session = false;
  private foreground = AppState.currentState === 'active';
  /** Degraded while backgrounded. Emitted on the next foreground tick so old timers stay stopped. */
  private pendingInactive = false;
  private appStateSub: NativeEventSubscription | null = null;

  constructor() {
    super();
    this.appStateSub = AppState.addEventListener('change', this.onAppState);
  }

  /** Logged-in shell only. Logout drops the cursor so the next login handshakes. */
  setSession(on: boolean): void {
    if (on === this.session) return;
    this.session = on;
    if (!on) {
      this.stopped = true;
      this._clearTimer();
      this.cursor = null;
      this.failures = 0;
      this.degraded = false;
      this.pendingInactive = false;
      this._setActive(false);
      return;
    }
    this.stopped = false;
    this.cursor = null;
    this.failures = 0;
    this.degraded = false;
    this.pendingInactive = false;
    this._requestTick();
    this._syncTimer();
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  override destroy(): void {
    this.stopped = true;
    this.session = false;
    this._clearTimer();
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.listeners = [];
    super.destroy();
  }

  private onAppState = (state: AppStateStatus): void => {
    const next = state === 'active';
    const was = this.foreground;
    this.foreground = next;
    if (!this.session || this.stopped) return;
    // Background pauses the timer but stays active, so pages do not restart the old polls.
    if (!next) {
      this._clearTimer();
      return;
    }
    if (was) return;
    if (this.pendingInactive) {
      this.pendingInactive = false;
      this._setActive(false);
    }
    this._requestTick();
    this._syncTimer(true);
  };

  private _requestTick(): void {
    if (this.stopped || !this.session || !this.foreground || this.inflight) return;
    void this._poll();
  }

  private async _poll(): Promise<void> {
    this.inflight = true;
    try {
      let pages = 0;
      while (pages < SYNC_BURST_PAGES && !this.stopped && this.foreground) {
        const handshake = this.cursor === null;
        const res = await request<SyncPollResponse>(this._path());
        if (this.stopped) return;
        // A page that lands in the background is left unread. Foreground polls the same cursor.
        if (!this.foreground) break;
        if (!usablePoll(res)) throw new Error('sync response');
        pages += 1;
        const more = this._apply(res, handshake);
        if (!more) break;
      }
    } catch (err) {
      if (!this.stopped) this._fail(err);
    } finally {
      this.inflight = false;
      if (!this.stopped) this._syncTimer();
    }
  }

  private _apply(res: SyncPollResponse, handshake: boolean): boolean {
    // A failed or 404 poll leaves cursor null. That later handshake would skip the gap.
    const recover = handshake && (this.degraded || this.failures > 0);
    this.failures = 0;
    this.degraded = false;
    this.cursor = res.cursor;
    this._setActive(true);
    const more = res.more === true;
    if (handshake) {
      devDebug('sync.handshake', { cursor: res.cursor, recover });
      if (recover) this._emit({ type: 'reset' });
      return more;
    }
    if (res.reset === true) {
      devDebug('sync.reset', { cursor: res.cursor });
      this._emit({ type: 'reset' });
      return more;
    }
    if (res.changes.length > 0) {
      devDebug('sync.changes', { n: res.changes.length, cursor: res.cursor });
      this._emit({ type: 'changes', changes: res.changes });
    }
    return more;
  }

  private _fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      // clearAuth already logged the user out. Do not probe and do not flip active.
      this.stopped = true;
      this._clearTimer();
      devDebug('sync.stopped', { status: 401 });
      return;
    }
    if (err instanceof ApiError && err.status === 404) {
      // Route missing or SYNC_ENABLED=false. Not a logout, and not three strikes.
      this.degraded = true;
      this._deactivate();
      devDebug('sync.degraded', { status: 404 });
      return;
    }
    this.failures += 1;
    if (this.failures >= 3) {
      this.degraded = true;
      this._deactivate();
      devDebug('sync.degraded', { failures: this.failures });
    }
  }

  private _deactivate(): void {
    if (this.foreground) {
      this.pendingInactive = false;
      this._setActive(false);
      return;
    }
    this.pendingInactive = true;
  }

  private _delayMs(): number {
    if (this.degraded) return nextPollDelayMs(3);
    return nextPollDelayMs(this.failures);
  }

  private _syncTimer(force = false): void {
    if (this.stopped || !this.session || !this.foreground) {
      this._clearTimer();
      return;
    }
    const delay = this._delayMs();
    if (!force && this.timer !== null && this.armedDelay === delay) return;
    this._clearTimer();
    this.armedDelay = delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armedDelay = null;
      if (this.stopped || !this.session || !this.foreground) return;
      this._requestTick();
      this._syncTimer();
    }, delay);
  }

  private _clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.armedDelay = null;
  }

  private _path(): string {
    if (this.cursor === null) return '/api/sync';
    return `/api/sync?since=${this.cursor}`;
  }

  private _setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this._emit({ type: 'active', active });
  }

  private _emit(event: SyncEvent): void {
    for (const listener of this.listeners.slice()) {
      try {
        listener(event);
      } catch (err) {
        devDebug('sync.listener', { message: err instanceof Error ? err.message : 'error' });
      }
    }
  }
}

function devDebug(message: string, extra: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug(message, extra);
}

function usablePoll(value: unknown): value is SyncPollResponse {
  if (typeof value !== 'object' || value === null) return false;
  const cursor = (value as { cursor?: unknown }).cursor;
  const changes = (value as { changes?: unknown }).changes;
  return typeof cursor === 'string' && /^\d+$/.test(cursor) && Array.isArray(changes);
}
