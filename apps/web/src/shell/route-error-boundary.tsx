import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 变化时重置错误态（传 location.pathname，让用户点击其它导航可自愈） */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

/**
 * 路由 chunk 加载失败（弱网、发版后旧 hash 失效）的兜底，避免整页白屏。
 * 包在 Layout 的 Outlet 外，壳与导航保持可用，用户可直接点别的页面。
 */
export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[route] page render failed', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-error" role="alert">
        <p className="route-error-title">网络不佳，页面加载失败</p>
        <p className="route-error-hint">请检查网络后重试；若刚更新过版本，重新加载即可恢复。</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}
