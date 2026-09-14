import { Service } from '@rabjs/react';
import { LLM_PROVIDERS, type LlmConfig, type LlmProvider, type LlmTestResult } from '@inwit/dto';
import { errorMessage } from '@/api/client';
import {
  createLlmConfig,
  deleteLlmConfig,
  listLlmConfigs,
  setDefaultLlmConfig,
  testLlmConfig,
} from '@/api/llm';

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

  async load(): Promise<void> {
    this.error = null;
    try {
      this.configs = await listLlmConfigs();
    } catch (err) {
      this.error = errorMessage(err, '加载模型配置失败');
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
