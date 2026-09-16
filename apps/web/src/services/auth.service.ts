import { Service } from '@rabjs/react';
import type { User } from '@inwit/dto';
import { getMe, loginUser, logoutUser, registerUser } from '@/api/auth';
import { ApiError, bootAuth, errorMessage, setUnauthorizedHandler } from '@/api/client';
import { AUTH_CLEARED_EVENT } from '@/api/tauri';

const AVATAR_REFRESH_COOLDOWN_MS = 30_000;

export class AuthService extends Service {
  user: User | null = null;
  bootstrapping = true;
  bootstrapError: string | null = null;
  /** Last avatar URL that failed to load; keep until a different URL arrives. */
  brokenAvatarUrl: string | null = null;
  private avatarRefreshAt = 0;

  constructor() {
    super();
    setUnauthorizedHandler(() => {
      this.user = null;
      this.brokenAvatarUrl = null;
    });
    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_CLEARED_EVENT, () => {
        this.user = null;
        this.brokenAvatarUrl = null;
      });
    }
    void this.bootstrap();
  }

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  get displayLabel(): string {
    const name = this.user?.displayName?.trim();
    if (name) return name;
    return this.user?.email ?? '';
  }

  get displayInitial(): string {
    const ch = this.displayLabel.charAt(0);
    return ch ? ch.toUpperCase() : '?';
  }

  get visibleAvatarUrl(): string | null {
    const url = this.user?.avatarUrl;
    if (!url || url === this.brokenAvatarUrl) return null;
    return url;
  }

  setUser(user: User | null): void {
    this.user = user;
    if (!user) this.brokenAvatarUrl = null;
  }

  onAvatarError(): void {
    const url = this.user?.avatarUrl;
    if (url) this.brokenAvatarUrl = url;
    const now = Date.now();
    if (now - this.avatarRefreshAt < AVATAR_REFRESH_COOLDOWN_MS) return;
    this.avatarRefreshAt = now;
    void this.refreshMe();
  }

  async refreshMe(): Promise<void> {
    try {
      this.user = await getMe();
    } catch {
      // Keep the current session; avatar falls back to the initial.
    }
  }

  async bootstrap(): Promise<void> {
    this.bootstrapping = true;
    this.bootstrapError = null;
    try {
      await bootAuth();
      this.user = await getMe();
    } catch (err) {
      this.user = null;
      if (!(err instanceof ApiError && err.status === 401)) {
        this.bootstrapError = errorMessage(err, '无法连接服务器');
      }
    } finally {
      this.bootstrapping = false;
    }
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await loginUser({ email, password });
    this.user = user;
    this.brokenAvatarUrl = null;
    this.bootstrapError = null;
  }

  async register(email: string, password: string): Promise<void> {
    const { user } = await registerUser({ email, password });
    this.user = user;
    this.brokenAvatarUrl = null;
    this.bootstrapError = null;
  }

  async logout(): Promise<void> {
    try {
      await logoutUser();
    } catch {
      // Cookie may already be gone; still clear local session.
    }
    this.user = null;
    this.brokenAvatarUrl = null;
  }
}
