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
 * 文章学习工作区（T8a）：三模式、分隔比例、临时放大、降级与恢复、
 * 布局偏好按 用户+文章+主题 持久化（localStorage）。
 */
export class StudyWorkspaceService extends Service {
  layout: WorkspaceLayoutState = { ...DEFAULT_LAYOUT };
  containerWidth = 0;
  containerHeight = 0;
  lastFocus: 'outline' | 'concepts' = 'outline';
  storageAvailable = true;
  private scopeKey: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { scopeKey: string; layout: WorkspaceLayoutState } | null = null;

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
    if (this.scopeKey !== scopeId) this.flushPending();
    this.scopeKey = scopeId;
    const state = loadWorkspaceState(this.userId);
    const saved = state.layouts[scopeId];
    this.layout = saved ? { ...DEFAULT_LAYOUT, ...saved } : { ...DEFAULT_LAYOUT };
    this.containerWidth = 0;
    this.containerHeight = 0;
    this.lastFocus = 'outline';
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
    const scopeKey = this.scopeKey;
    if (!scopeKey) return;
    this.pending = { scopeKey, layout: { ...this.layout } };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushPending(), 500);
  }

  /** 把已排上的布局写回它被修改时的那篇文章，而不是写到此刻打开的文章。 */
  private flushPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!pending) return;
    const state = loadWorkspaceState(this.userId);
    state.layouts[pending.scopeKey] = pending.layout;
    const ok = saveWorkspaceState(this.userId, state);
    if (!ok) this.storageAvailable = false;
  }
}
