import type { StudyArrangement, StudyMode, WorkspaceLayoutState } from './study-state.js';

/**
 * 工作区布局决策（T8a）：preferred 与 effective 分离；
 * 按容器实际尺寸降级，空间恢复后回到用户偏好。
 * 阈值来自 M0 设计走查（设计基线，不是用户测试阈值）：
 * - 宽 ≥1650 且高 ≥420：可三栏（columns）；
 * - 宽 ≥1280 且高 ≥720：正文左 + 双图上下（stacked）；
 * - ≤760：正文在上、当前学习区在下（单图聚焦）；
 * - 其余：按最近主动焦点聚焦单图。
 */

export interface EffectiveLayout {
  /** 实际生效的模式（可能因空间不足降级）。 */
  mode: StudyMode;
  arrangement: StudyArrangement;
  /** 是否因空间不足降级（恢复后应回到 preferredMode）。 */
  degraded: boolean;
  /** 降级时聚焦哪个面板（最近主动焦点或偏好的第一选择）。 */
  focusedPane: 'outline' | 'concepts' | null;
}

// 实现校准：学习区宽度跟卡片栏拖动（列表 220–520，脑图和禅模式更宽）。
// 对照的可行性取决于工作区正文余量与高度。
// 与 M0 原型的全宽比例阈值不同，这里按真实布局余量设定（M4 交付记录有偏差说明）。
const COLUMNS_MIN_W = 1400;
const STACKED_MIN_W = 980;
const COMPARE_MIN_H = 560;
const NARROW_MAX_W = 760;

export function effectiveLayout(
  preferred: WorkspaceLayoutState,
  container: { width: number; height: number },
  lastFocus: 'outline' | 'concepts' = 'outline',
): EffectiveLayout {
  const mode = preferred.preferredMode;
  if (container.width <= 0 || container.height <= 0) {
    // 隐藏区零尺寸：不降级、不清状态，沿用偏好（渲染方跳过测量）。
    return { mode, arrangement: preferred.arrangement, degraded: false, focusedPane: null };
  }
  if (mode !== 'compare') {
    return { mode, arrangement: preferred.arrangement, degraded: false, focusedPane: null };
  }
  if (container.width <= NARROW_MAX_W) {
    return { mode: lastFocus, arrangement: 'stacked', degraded: true, focusedPane: lastFocus };
  }
  if (container.width >= COLUMNS_MIN_W && container.height >= COMPARE_MIN_H) {
    return {
      mode,
      arrangement: preferred.arrangement === 'stacked' ? 'stacked' : 'columns',
      degraded: false,
      focusedPane: null,
    };
  }
  if (container.width >= STACKED_MIN_W && container.height >= COMPARE_MIN_H) {
    return { mode, arrangement: 'stacked', degraded: false, focusedPane: null };
  }
  return { mode: lastFocus, arrangement: 'stacked', degraded: true, focusedPane: lastFocus };
}

/** 分隔比例限幅（保护正文与图的可读面积）。 */
export function clampMainRatio(ratio: number): number {
  return Math.min(0.75, Math.max(0.3, ratio));
}

export function clampDockRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio));
}

/** 分隔条拖动。横向对照用 clientX，上下对照用 clientY；size 是被分开的那一边的长度。 */
export function dockRatioFromDrag(startRatio: number, start: number, current: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(start) || !Number.isFinite(current)) return clampDockRatio(startRatio);
  return clampDockRatio(startRatio + (current - start) / size);
}
