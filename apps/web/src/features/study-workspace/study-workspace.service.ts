import { Service } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';
import { effectiveLayout, clampMainRatio, clampDockRatio, type EffectiveLayout } from './study-layout.js';
import {
  DEFAULT_LAYOUT,
  loadWorkspaceState,
  saveWorkspaceState,
  type StudyMode,
  type WorkspaceLayoutState,
} from './study-state.js';

/**
 * 文章学习工作区：三模式、分隔比例、临时放大、降级与恢复。
 * 选中的模式、排列和分隔比例按用户全局保留（localStorage），切文章不换。
 * 学习区外侧宽度在 UiPrefsService，本来就是全局的。
 */
export class StudyWorkspaceService extends Service {
  layout: WorkspaceLayoutState = { ...DEFAULT_LAYOUT };
  containerWidth = 0;
  containerHeight = 0;
  lastFocus: 'outline' | 'concepts' = 'outline';
  storageAvailable = true;
  private scopeKey: string | null = null;
  private loadedUserId: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { userId: string; layout: WorkspaceLayoutState } | null = null;

  get authed(): AuthService {
    return this.resolve(AuthService);
  }

  get userId(): string {
    return this.authed.user?.id ?? 'anonymous';
  }

  get effective(): EffectiveLayout {
    return effectiveLayout(this.layout, { width: this.containerWidth, height: this.containerHeight }, this.lastFocus);
  }

  get showOutline(): boolean {
    const effective = this.effective;
    if (this.layout.zoomedPane) return this.layout.zoomedPane === 'outline';
    if (effective.degraded) return effective.mode === 'outline';
    return effective.mode === 'outline' || effective.mode === 'compare';
  }

  get showConcepts(): boolean {
    const effective = this.effective;
    if (this.layout.zoomedPane) return this.layout.zoomedPane === 'concepts';
    if (effective.degraded) return effective.mode === 'concepts';
    return effective.mode === 'concepts' || effective.mode === 'compare';
  }

  get isCompare(): boolean {
    return this.effective.mode === 'compare' && !this.layout.zoomedPane;
  }

  boot(scopeId: string): void {
    const switching = this.scopeKey !== null && this.scopeKey !== scopeId;
    if (switching) this.flushPending();
    this.scopeKey = scopeId;
    if (this.loadedUserId === this.userId) {
      if (switching && this.layout.zoomedPane) this.layout = { ...this.layout, zoomedPane: null };
      return;
    }
    const state = loadWorkspaceState(this.userId);
    const saved = state.layout ?? state.layouts[scopeId];
    this.layout = saved ? { ...DEFAULT_LAYOUT, ...saved, zoomedPane: null } : { ...DEFAULT_LAYOUT };
    this.loadedUserId = this.userId;
    this.containerWidth = 0;
    this.containerHeight = 0;
    this.lastFocus = this.layout.preferredMode === 'concepts' ? 'concepts' : 'outline';
    if (!state.layout && saved) {
      state.layout = { ...this.layout };
      const ok = saveWorkspaceState(this.userId, state);
      if (!ok) this.storageAvailable = false;
    }
  }

  setContainer(width: number, height: number): void {
    // 零尺寸（隐藏区）不清状态
    if (width <= 0 || height <= 0) return;
    this.containerWidth = width;
    this.containerHeight = height;
  }

  setMode(mode: StudyMode): void {
    this.lastFocus = mode === 'concepts' ? 'concepts' : 'outline';
    this.layout = { ...this.layout, preferredMode: mode, zoomedPane: null };
    this.persist();
  }

  setMainRatio(ratio: number): void {
    this.layout = { ...this.layout, mainRatio: clampMainRatio(ratio) };
    this.persist();
  }

  setDockRatio(ratio: number): void {
    this.layout = { ...this.layout, dockRatio: clampDockRatio(ratio) };
    this.persist();
  }

  toggleArrangement(): void {
    this.layout = {
      ...this.layout,
      arrangement: this.layout.arrangement === 'columns' ? 'stacked' : 'columns',
    };
    this.persist();
  }

  zoomPane(pane: 'outline' | 'concepts' | null): void {
    this.layout = { ...this.layout, zoomedPane: pane };
  }

  markFocus(pane: 'outline' | 'concepts'): void {
    this.lastFocus = pane;
  }

  private persist(): void {
    const userId = this.loadedUserId;
    if (!userId) return;
    this.pending = { userId, layout: { ...this.layout, zoomedPane: null } };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushPending(), 500);
  }

  /** 把已排上的全局布局写盘。切文章时提前落盘，避免 500ms 内刷新丢掉这次调整。 */
  private flushPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!pending) return;
    const state = loadWorkspaceState(pending.userId);
    state.layout = pending.layout;
    const ok = saveWorkspaceState(pending.userId, state);
    if (!ok) this.storageAvailable = false;
  }
}
