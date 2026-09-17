import { Service } from '@rabjs/react';
import {
  ACCESS_TOKEN_MAX_PER_USER,
  ACCESS_TOKEN_NAME_MAX,
  AVATAR_MAX_BYTES,
  LLM_PROVIDERS,
  OCR_DEFAULT_MODEL,
  type AccessToken,
  type AccessTokenLog,
  type ArchivedAnnotation,
  type ArchivedCard,
  type LlmConfig,
  type LlmProvider,
  type LlmTestResult,
  type OcrConfig,
  type OcrTestResult,
  type UpdateProfileInput,
  type UpsertOcrConfigInput,
} from '@inwit/dto';
import {
  confirmAvatar,
  createAccessToken,
  listAccessTokenLogs,
  listAccessTokens,
  requestAvatarUploadUrl,
  revealAccessToken,
  updateMe,
} from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { destroyAnnotation, listArchivedAnnotations, restoreAnnotation } from '@/api/annotations';
import { destroyCard, listArchivedCards, restoreCard } from '@/api/cards';
import { putViaFetch } from '@/pages/docs/upload-asset';
import {
  createLlmConfig,
  deleteLlmConfig,
  listLlmConfigs,
  setDefaultLlmConfig,
  testLlmConfig,
} from '@/api/llm';
import { getOcrConfig, testOcrConfig, upsertOcrConfig } from '@/api/ocr';
import { AuthService } from '@/services/auth.service';

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  zhipu: '智谱',
  dashscope: '通义百炼',
};

export const PROVIDER_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-sonnet-4-5',
  zhipu: 'glm-4',
  dashscope: 'qwen-plus',
};

export const PROVIDERS = LLM_PROVIDERS;

export type SettingsSection = 'profile' | 'appearance' | 'models' | 'ocr' | 'token' | 'archive';
export type TokenPane = 'list' | 'logs';

export { ACCESS_TOKEN_MAX_PER_USER, ACCESS_TOKEN_NAME_MAX };

const TOAST_MS = 3200;
const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function normalizeAvatarMime(type: string): string | null {
  const mime = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'image/jpg') return 'image/jpeg';
  return AVATAR_MIME.has(mime) ? mime : null;
}

export class SettingsService extends Service {
  configs: LlmConfig[] = [];
  error: string | null = null;
  formError: string | null = null;
  provider: LlmProvider = 'dashscope';
  model = PROVIDER_MODELS.dashscope;
  apiKey = '';
  baseUrl = '';
  isDefault = false;
  testingId: string | null = null;
  testResults: Record<string, LlmTestResult> = {};
  busyId: string | null = null;
  section: SettingsSection = 'profile';
  displayName = '';
  email = '';
  profileError: string | null = null;
  avatarError: string | null = null;
  ocrConfig: OcrConfig | null = null;
  ocrApiKey = '';
  ocrModel = OCR_DEFAULT_MODEL;
  ocrBaseUrl = '';
  ocrFormError: string | null = null;
  ocrTestResult: OcrTestResult | null = null;
  tokenPane: TokenPane = 'list';
  accessTokens: AccessToken[] = [];
  tokenName = '';
  accessTokenError: string | null = null;
  copyingId: string | null = null;
  accessTokenLogs: AccessTokenLog[] = [];
  accessTokenLogsTotal = 0;
  accessTokenLogsPage = 1;
  accessTokenLogsLimit = 20;
  accessTokenLogsError: string | null = null;
  archivedCards: ArchivedCard[] = [];
  archivedCardsTotal = 0;
  archivedCardsPage = 1;
  archivedCardsLimit = 20;
  archivedCardsError: string | null = null;
  archivedAnnotations: ArchivedAnnotation[] = [];
  archivedAnnotationsTotal = 0;
  archivedAnnotationsPage = 1;
  archivedAnnotationsLimit = 20;
  archivedAnnotationsError: string | null = null;
  toast: string | null = null;
  toastTimer: ReturnType<typeof setTimeout> | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  hydrateProfile(): void {
    const user = this.auth.user;
    this.displayName = user?.displayName ?? '';
    this.email = user?.email ?? '';
  }

  applyHash(): void {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === 'token-logs') {
      this.section = 'token';
      this.tokenPane = 'logs';
      return;
    }
    if (
      hash === 'models' ||
      hash === 'appearance' ||
      hash === 'profile' ||
      hash === 'ocr' ||
      hash === 'token' ||
      hash === 'archive'
    ) {
      this.section = hash;
      if (hash === 'token') this.tokenPane = 'list';
    }
  }

  setSection(section: SettingsSection): void {
    this.section = section;
    const el = document.getElementById(section);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  setDisplayName(value: string): void {
    this.displayName = value;
  }

  setEmail(value: string): void {
    this.email = value;
  }

  showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  override destroy(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    super.destroy();
  }

  async saveProfile(): Promise<void> {
    this.profileError = null;
    const displayName = this.displayName.trim();
    const email = this.email.trim();
    if (email.length === 0) {
      this.profileError = '请填写邮箱';
      return;
    }
    const input: UpdateProfileInput = { email };
    if (displayName.length > 0) input.displayName = displayName;
    try {
      const user = await updateMe(input);
      this.auth.setUser(user);
      this.displayName = user.displayName ?? '';
      this.email = user.email;
      this.showToast('已保存');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        this.profileError = '这个邮箱已被使用';
        return;
      }
      this.profileError = errorMessage(err, '保存失败');
    }
  }

  async uploadAvatar(file: File): Promise<void> {
    this.avatarError = null;
    if (!file.type.startsWith('image/')) {
      this.avatarError = '请选择图片文件';
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      this.avatarError = '图片不能超过 5MB';
      return;
    }
    const contentType = normalizeAvatarMime(file.type);
    if (!contentType) {
      this.avatarError = '请使用 JPEG、PNG 或 WebP 图片';
      return;
    }
    try {
      const { uploadUrl, key } = await requestAvatarUploadUrl({
        contentType,
        sizeBytes: file.size,
      });
      const put = await putViaFetch(uploadUrl, file, contentType);
      if (!put.ok) {
        this.avatarError = '头像上传失败';
        return;
      }
      const user = await confirmAvatar({ key });
      this.auth.setUser(user);
      this.showToast('头像已更新');
    } catch (err) {
      this.avatarError = errorMessage(err, '头像上传失败');
    }
  }

  async load(): Promise<void> {
    this.error = null;
    this.hydrateProfile();
    try {
      const [configs, ocr, tokens] = await Promise.all([
        listLlmConfigs(),
        getOcrConfig(),
        listAccessTokens(),
      ]);
      this.configs = configs;
      this.applyOcrConfig(ocr);
      this.accessTokens = tokens;
      if (this.tokenPane === 'logs') void this.loadAccessTokenLogs();
      void this.loadArchivedCards();
      void this.loadArchivedAnnotations();
    } catch (err) {
      this.error = errorMessage(err, '加载模型配置失败');
    }
  }

  applyOcrConfig(config: OcrConfig | null): void {
    this.ocrConfig = config;
    this.ocrApiKey = '';
    this.ocrModel = config?.model || OCR_DEFAULT_MODEL;
    this.ocrBaseUrl = config?.baseUrl ?? '';
  }

  setOcrApiKey(value: string): void {
    this.ocrApiKey = value;
  }

  setOcrModel(value: string): void {
    this.ocrModel = value;
  }

  setOcrBaseUrl(value: string): void {
    this.ocrBaseUrl = value;
  }

  async saveOcr(): Promise<void> {
    this.ocrFormError = null;
    const apiKey = this.ocrApiKey.trim();
    const model = this.ocrModel.trim() || OCR_DEFAULT_MODEL;
    if (!this.ocrConfig && apiKey.length === 0) {
      this.ocrFormError = '请填写密钥';
      return;
    }
    const baseUrl = this.ocrBaseUrl.trim();
    const input: UpsertOcrConfigInput = { model };
    if (apiKey.length > 0) input.apiKey = apiKey;
    if (baseUrl.length > 0) input.baseUrl = baseUrl;
    else if (this.ocrConfig) input.baseUrl = null;
    try {
      const saved = await upsertOcrConfig(input);
      this.applyOcrConfig(saved);
      this.showToast('已保存');
    } catch (err) {
      this.ocrFormError = errorMessage(err, '保存失败');
    }
  }

  async testOcr(): Promise<void> {
    this.ocrFormError = null;
    try {
      const result = await testOcrConfig();
      this.ocrTestResult = result;
      this.showToast(result.ok ? '连通正常' : `不通：${result.error}`);
    } catch (err) {
      const message = errorMessage(err, '测试失败');
      this.ocrTestResult = { ok: false, error: message };
      this.showToast(message);
    }
  }

  setProvider(value: LlmProvider): void {
    const previousDefault = PROVIDER_MODELS[this.provider];
    this.provider = value;
    if (this.model.length === 0 || this.model === previousDefault) {
      this.model = PROVIDER_MODELS[value];
    }
  }

  setModel(value: string): void {
    this.model = value;
  }

  setApiKey(value: string): void {
    this.apiKey = value;
  }

  setBaseUrl(value: string): void {
    this.baseUrl = value;
  }

  setIsDefault(value: boolean): void {
    this.isDefault = value;
  }

  async add(): Promise<void> {
    this.formError = null;
    const apiKey = this.apiKey.trim();
    const model = this.model.trim();
    if (apiKey.length === 0 || model.length === 0) {
      this.formError = '请填写密钥和模型名';
      return;
    }
    try {
      const baseUrl = this.baseUrl.trim();
      const created = await createLlmConfig({
        provider: this.provider,
        apiKey,
        model,
        isDefault: this.isDefault,
        ...(baseUrl.length > 0 ? { baseUrl } : {}),
      });
      this.configs = [created, ...this.configs.map((item) =>
        created.isDefault ? { ...item, isDefault: false } : item,
      )];
      this.apiKey = '';
      this.baseUrl = '';
      this.isDefault = false;
    } catch (err) {
      this.formError = errorMessage(err, '新增失败');
    }
  }

  async remove(id: string): Promise<void> {
    this.busyId = id;
    this.error = null;
    try {
      await deleteLlmConfig(id);
      this.configs = this.configs.filter((item) => item.id !== id);
    } catch (err) {
      this.error = errorMessage(err, '删除失败');
    } finally {
      this.busyId = null;
    }
  }

  async makeDefault(id: string): Promise<void> {
    this.busyId = id;
    this.error = null;
    try {
      const updated = await setDefaultLlmConfig(id);
      this.configs = this.configs.map((item) =>
        item.id === updated.id ? updated : { ...item, isDefault: false },
      );
    } catch (err) {
      this.error = errorMessage(err, '设为默认失败');
    } finally {
      this.busyId = null;
    }
  }

  setTokenPane(pane: TokenPane): void {
    this.tokenPane = pane;
    if (pane === 'logs') void this.loadAccessTokenLogs();
  }

  setTokenName(value: string): void {
    this.tokenName = value;
  }

  get accessTokenLogsHasPrev(): boolean {
    return this.accessTokenLogsPage > 1;
  }

  get accessTokenLogsHasNext(): boolean {
    return this.accessTokenLogsPage * this.accessTokenLogsLimit < this.accessTokenLogsTotal;
  }

  get archivedCardsHasPrev(): boolean {
    return this.archivedCardsPage > 1;
  }

  get archivedCardsHasNext(): boolean {
    return this.archivedCardsPage * this.archivedCardsLimit < this.archivedCardsTotal;
  }

  get archivedAnnotationsHasPrev(): boolean {
    return this.archivedAnnotationsPage > 1;
  }

  get archivedAnnotationsHasNext(): boolean {
    return this.archivedAnnotationsPage * this.archivedAnnotationsLimit < this.archivedAnnotationsTotal;
  }

  async loadArchivedCards(page = this.archivedCardsPage): Promise<void> {
    this.archivedCardsError = null;
    const nextPage = Math.max(1, page);
    try {
      const result = await listArchivedCards({ page: nextPage, limit: this.archivedCardsLimit });
      this.archivedCards = result.items;
      this.archivedCardsTotal = result.total;
      this.archivedCardsPage = nextPage;
    } catch (err) {
      this.archivedCardsError = errorMessage(err, '回收站加载失败');
    }
  }

  async loadArchivedAnnotations(page = this.archivedAnnotationsPage): Promise<void> {
    this.archivedAnnotationsError = null;
    const nextPage = Math.max(1, page);
    try {
      const result = await listArchivedAnnotations({
        page: nextPage,
        limit: this.archivedAnnotationsLimit,
      });
      this.archivedAnnotations = result.items;
      this.archivedAnnotationsTotal = result.total;
      this.archivedAnnotationsPage = nextPage;
    } catch (err) {
      this.archivedAnnotationsError = errorMessage(err, '回收站加载失败');
    }
  }

  /** 删到当前页空了且不是第一页时，往回翻一页。 */
  private archivedPageAfterRemoval(page: number, remaining: number): number {
    return remaining === 1 && page > 1 ? page - 1 : page;
  }

  async restoreArchivedCard(id: string): Promise<void> {
    try {
      await restoreCard(id);
      await this.loadArchivedCards(
        this.archivedPageAfterRemoval(this.archivedCardsPage, this.archivedCards.length),
      );
      this.showToast('已恢复');
    } catch (err) {
      this.showToast(errorMessage(err, '恢复失败'));
    }
  }

  async destroyArchivedCard(id: string): Promise<void> {
    try {
      await destroyCard(id);
      await this.loadArchivedCards(
        this.archivedPageAfterRemoval(this.archivedCardsPage, this.archivedCards.length),
      );
      this.showToast('已彻底删除');
    } catch (err) {
      this.showToast(errorMessage(err, '删除失败'));
    }
  }

  async restoreArchivedAnnotation(id: string): Promise<void> {
    try {
      await restoreAnnotation(id);
      await this.loadArchivedAnnotations(
        this.archivedPageAfterRemoval(this.archivedAnnotationsPage, this.archivedAnnotations.length),
      );
      this.showToast('已恢复');
    } catch (err) {
      this.showToast(errorMessage(err, '恢复失败'));
    }
  }

  async destroyArchivedAnnotation(id: string): Promise<void> {
    try {
      await destroyAnnotation(id);
      await this.loadArchivedAnnotations(
        this.archivedPageAfterRemoval(this.archivedAnnotationsPage, this.archivedAnnotations.length),
      );
      this.showToast('已彻底删除');
    } catch (err) {
      this.showToast(errorMessage(err, '删除失败'));
    }
  }

  async generateAccessToken(): Promise<void> {
    this.accessTokenError = null;
    const name = this.tokenName.trim();
    if (name.length === 0) {
      this.accessTokenError = '请填写令牌名称';
      return;
    }
    if (this.accessTokens.length >= ACCESS_TOKEN_MAX_PER_USER) {
      this.accessTokenError = `最多 ${ACCESS_TOKEN_MAX_PER_USER} 个接口令牌`;
      return;
    }
    try {
      const created = await createAccessToken({ name });
      this.accessTokens = [created, ...this.accessTokens];
      this.tokenName = '';
      this.showToast('已生成');
    } catch (err) {
      this.accessTokenError = errorMessage(err, '生成失败');
    }
  }

  async copyAccessToken(id: string): Promise<void> {
    this.accessTokenError = null;
    this.copyingId = id;
    try {
      const { token } = await revealAccessToken(id);
      try {
        await navigator.clipboard.writeText(token);
        this.showToast('已复制');
        return;
      } catch {
        // Clipboard API needs a trusted gesture; fall back to a hidden textarea.
      }
      const ta = document.createElement('textarea');
      ta.value = token;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy')) {
          this.showToast('已复制');
          return;
        }
      } finally {
        ta.remove();
      }
      this.accessTokenError = '复制失败，请稍后重试';
    } catch (err) {
      this.accessTokenError = errorMessage(err, '复制失败');
    } finally {
      this.copyingId = null;
    }
  }

  async loadAccessTokenLogs(page = this.accessTokenLogsPage): Promise<void> {
    this.accessTokenLogsError = null;
    const nextPage = Math.max(1, page);
    const offset = (nextPage - 1) * this.accessTokenLogsLimit;
    try {
      const result = await listAccessTokenLogs({
        limit: this.accessTokenLogsLimit,
        offset,
      });
      this.accessTokenLogs = result.items;
      this.accessTokenLogsTotal = result.total;
      this.accessTokenLogsPage = nextPage;
    } catch (err) {
      this.accessTokenLogsError = errorMessage(err, '加载调用日志失败');
    }
  }

  async test(id: string): Promise<void> {
    this.testingId = id;
    this.error = null;
    try {
      const result = await testLlmConfig(id);
      this.testResults = { ...this.testResults, [id]: result };
    } catch (err) {
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, error: errorMessage(err, '测试失败') },
      };
    } finally {
      this.testingId = null;
    }
  }
}
