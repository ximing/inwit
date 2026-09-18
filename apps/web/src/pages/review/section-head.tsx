import { Link } from 'react-router';
import { ROUTES, weeklyReportsPath } from '@/routes';

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function todayLabel(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1)}月${String(now.getDate())}日 · 周${WEEKDAY_CN[now.getDay()] ?? ''}`;
}

/** 复习工作区共享页头：标题 + 一句注脚 + 「复习概览 / 学习周报」切换。 */
export function ReviewSectionHead({ active, lede }: { active: 'hub' | 'reports'; lede?: string }) {
  return (
    <div className="hub-head">
      <span className="hub-title">复习</span>
      <span className="hub-date">{lede ?? todayLabel()}</span>
      <nav className="hub-tabs" aria-label="复习栏目">
        <Link
          className={active === 'hub' ? 'hub-tab is-on' : 'hub-tab'}
          to={ROUTES.review}
          aria-current={active === 'hub' ? 'page' : undefined}
        >
          复习概览
        </Link>
        <Link
          className={active === 'reports' ? 'hub-tab is-on' : 'hub-tab'}
          to={weeklyReportsPath()}
          aria-current={active === 'reports' ? 'page' : undefined}
        >
          学习周报
        </Link>
      </nav>
    </div>
  );
}
