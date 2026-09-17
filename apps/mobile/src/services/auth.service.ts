import { Service } from '@rabjs/react';
import type { User } from '@inwit/dto';
import * as SecureStore from 'expo-secure-store';
import {
  createAccessToken,
  getMe,
  listAccessTokens,
  loginUser,
  registerUser,
  revealAccessToken,
} from '@/api/auth';
import { ApiError, createMobileClient, errorMessage, setUnauthorizedHandler } from '@/api/client';
import { getApiBaseUrl } from '@/config';

export const MOBILE_PAT_NAME = 'inwit-mobile';
export const PAT_STORAGE_KEY = 'inwit.pat';

export class AuthService extends Service {
  user: User | null = null;
  bootstrapping = true;
  bootstrapError: string | null = null;
  /** Last avatar URL that failed to load; keep until a different URL arrives. */
  brokenAvatarUrl: string | null = null;
  /** `undefined` = not read from SecureStore yet. */
  private patMemory: string | null | undefined = undefined;

  constructor() {
    super();
    createMobileClient({
      baseUrl: getApiBaseUrl(),
      getToken: () => this.readPat(),
      onUnauthorized: () => {
        this.handleUnauthorized();
      },
    });
    setUnauthorizedHandler(() => {
      this.handleUnauthorized();
    });
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

  async readPat(): Promise<string | null> {
    if (this.patMemory !== undefined) return this.patMemory;
    try {
      this.patMemory = await SecureStore.getItemAsync(PAT_STORAGE_KEY);
    } catch {
      this.patMemory = null;
    }
    return this.patMemory;
  }

  async writePat(token: string): Promise<void> {
    this.patMemory = token;
    await SecureStore.setItemAsync(PAT_STORAGE_KEY, token);
  }

  async deletePat(): Promise<void> {
    this.patMemory = null;
    try {
      await SecureStore.deleteItemAsync(PAT_STORAGE_KEY);
    } catch {
      // Keychain / Keystore may already be empty.
    }
  }

  setUser(user: User | null): void {
    this.user = user;
    if (!user) this.brokenAvatarUrl = null;
  }

  handleUnauthorized(): void {
    this.user = null;
    this.brokenAvatarUrl = null;
    void this.deletePat();
  }

  async bootstrap(): Promise<void> {
    this.bootstrapping = true;
    this.bootstrapError = null;
    try {
      const pat = await this.readPat();
      if (!pat) {
        this.user = null;
        return;
      }
      this.user = await getMe();
    } catch (err) {
      this.user = null;
      if (err instanceof ApiError && (err.status === 401 || err.code === 'INVALID_TOKEN')) {
        await this.deletePat();
      } else {
        this.bootstrapError = errorMessage(err, '无法连接服务器');
      }
    } finally {
      this.bootstrapping = false;
    }
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await loginUser({ email, password });
    const pat = await this.issueOrReusePat();
    await this.writePat(pat);
    this.user = user;
    this.brokenAvatarUrl = null;
    this.bootstrapError = null;
  }

  async register(email: string, password: string): Promise<void> {
    const { user } = await registerUser({ email, password });
    const pat = await this.issueOrReusePat();
    await this.writePat(pat);
    this.user = user;
    this.brokenAvatarUrl = null;
    this.bootstrapError = null;
  }

  async logout(): Promise<void> {
    await this.deletePat();
    this.user = null;
    this.brokenAvatarUrl = null;
  }

  private async issueOrReusePat(): Promise<string> {
    const tokens = await listAccessTokens();
    const existing = tokens.find((item) => item.name === MOBILE_PAT_NAME);
    const id = existing ? existing.id : (await createAccessToken({ name: MOBILE_PAT_NAME })).id;
    const { token } = await revealAccessToken(id);
    return token;
  }
}
