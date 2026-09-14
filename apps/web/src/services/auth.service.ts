import { Service } from '@rabjs/react';
import type { User } from '@inwit/dto';
import { getMe, loginUser, logoutUser, registerUser } from '@/api/auth';
import { ApiError, errorMessage, setUnauthorizedHandler } from '@/api/client';

export class AuthService extends Service {
  user: User | null = null;
  bootstrapping = true;
  bootstrapError: string | null = null;

  constructor() {
    super();
    setUnauthorizedHandler(() => {
      this.user = null;
    });
    void this.bootstrap();
  }

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  async bootstrap(): Promise<void> {
    this.bootstrapping = true;
    this.bootstrapError = null;
    try {
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
    this.bootstrapError = null;
  }

  async register(email: string, password: string): Promise<void> {
    const { user } = await registerUser({ email, password });
    this.user = user;
    this.bootstrapError = null;
  }

  async logout(): Promise<void> {
    try {
      await logoutUser();
    } catch {
      // Cookie may already be gone; still clear local session.
    }
    this.user = null;
  }
}
