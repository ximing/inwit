/**
 * 触控板捏合和 Ctrl/⌘ + 滚轮的缩放倍率。
 *
 * Chrome、Safari 把触控板捏合合成带 ctrlKey 的 wheel，
 * deltaY ≈ -100 · ln(系统倍率)，还原就是 exp(-deltaY / 100)。
 * 以前每条事件固定 ±8%。捏合一帧往往只有大约 2%，手势一动就顶到缩放边界。
 * GAIN 把系统倍率再放慢，方便停在想要的比例上。
 */
const WHEEL_ZOOM_GAIN = 0.4;

/** Firefox 行模式的一格，折成大约这么多像素。 */
const LINE_PX = 16;

export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const pixels = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp((-pixels / 100) * WHEEL_ZOOM_GAIN);
}
