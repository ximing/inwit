import type { UsageDay } from '@inwit/dto';
import { formatTokens } from '@/lib/format';

function tickIndices(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= 5) return Array.from({ length: n }, (_, i) => i);
  const raw = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return [...new Set(raw)];
}

function shortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return isoDate;
  return `${month}-${day}`;
}

export function TokenTrend({ days }: { days: UsageDay[] }) {
  const first = days[0];
  if (!first) {
    return <p className="empty">这段时间还没花 tokens。消化或提问之后会记在这里。</p>;
  }

  const width = 720;
  const height = 220;
  const pad = { l: 52, r: 16, t: 18, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  let max = 0;
  for (const day of days) {
    if (day.totalTokens > max) max = day.totalTokens;
  }
  if (max <= 0) max = 1;

  const lastIndex = Math.max(days.length - 1, 1);
  const points = days.map((day, i) => {
    const x = pad.l + (i / lastIndex) * innerW;
    const y = pad.t + innerH - (day.totalTokens / max) * innerH;
    return { x, y, day };
  });
  const polyline = points.map((p) => `${String(p.x)},${String(p.y)}`).join(' ');
  const yTicks = [0, 0.5, 1].map((t) => ({
    y: pad.t + innerH - t * innerH,
    label: formatTokens(Math.round(max * t)),
  }));

  return (
    <div className="trend-wrap">
      <p className="trend-kicker">按天 token 趋势（UTC）</p>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label="每日 token 用量折线图"
      >
        {yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={tick.y}
              y2={tick.y}
              className="trend-grid"
            />
            <text x={pad.l - 8} y={tick.y + 4} textAnchor="end" className="trend-label">
              {tick.label}
            </text>
          </g>
        ))}
        <polyline points={polyline} className="trend-line" />
        {points.map((p) => (
          <circle key={p.day.date} cx={p.x} cy={p.y} r={days.length > 20 ? 2.2 : 3} className="trend-dot">
            <title>
              {p.day.date}: {formatTokens(p.day.totalTokens)} tokens
            </title>
          </circle>
        ))}
        {tickIndices(days.length).map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text key={p.day.date} x={p.x} y={height - 8} textAnchor="middle" className="trend-label">
              {shortDate(p.day.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
