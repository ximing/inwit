import { useEffect, useRef, useState } from 'react';

/**
 * AI 等待态展示原语（T28），类名与结构以 docs/design/v2/ingest-ai.html 为准。
 * 纯展示组件，无 Service、无依赖；样式在 apps/web/src/ai-flow.css。
 */

/** ✦ 呼吸小星；delay 单位为秒，用于多个 spark 错开相位。 */
export function AiSpark({ delay, className }: { delay?: number; className?: string }) {
  const cls = ['spark', className].filter(Boolean).join(' ');
  return (
    <span
      aria-hidden
      className={cls}
      style={delay !== undefined ? { animationDelay: `${delay}s` } : undefined}
    >
      ✦
    </span>
  );
}

/**
 * shimmer 阶段轮播文案：逻辑同设计稿 script 的 wireStage——
 * 每 intervalMs 先加 .out 淡出上浮，280ms 后切换下一段并加 .in 淡入。
 * stages.length <= 1 时静止不轮播；prefers-reduced-motion 开启时停在 stages[0]
 * 不轮播（CSS 降级只冻结动画，文字切换需在此拦截）；卸载时清理定时器与监听。
 */
export function AiStageText({
  stages,
  intervalMs = 1300,
  className,
}: {
  stages: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setIndex(0);
    setLeaving(false);
    if (reducedMotion || stagesRef.current.length <= 1) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setLeaving(true);
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % stagesRef.current.length);
        setLeaving(false);
      }, 280);
    }, intervalMs);
    return () => {
      clearInterval(timer);
      if (swap) clearTimeout(swap);
    };
  }, [intervalMs, reducedMotion]);

  const list = stagesRef.current;
  const text = list[Math.min(index, list.length - 1)] ?? '';
  const cls = ['shimmer-text', 'stage', leaving ? 'out' : 'in', className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{text}</span>;
}
