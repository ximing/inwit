import { Service } from '@rabjs/react';
import type { LlmConfig, LlmProvider } from '@inwit/dto';
import * as api from '@/api/translation.js';
import { listLlmConfigs } from '@/api/llm.js';
import { errorMessage } from '@/api/client.js';
export class TranslationSettingsService extends Service {
  provider: LlmProvider = 'openai';
  model = '';
  apiKey = '';
  baseUrl = '';
  saved = false;
  configs: LlmConfig[] = [];
  copyId = '';
  busy = false;
  message = '';
  messageKind: 'info' | 'success' | 'error' = 'info';
  async load() {
    try {
      const [settings, configs] = await Promise.all([
        api.getTranslationSettings(),
        listLlmConfigs(),
      ]);
      this.configs = configs;
      this.accept(settings.config);
    } catch (e) {
      this.messageKind = 'error';
      this.message = errorMessage(e);
    }
  }
  private accept(c: LlmConfig | null) {
    this.saved = !!c;
    this.provider = c?.provider ?? 'openai';
    this.model = c?.model ?? '';
    this.baseUrl = c?.baseUrl ?? '';
    this.apiKey = '';
  }
  async save() {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      this.accept(
        (
          await api.saveTranslationSettings({
            provider: this.provider,
            model: this.model,
            baseUrl: this.baseUrl || null,
            ...(this.apiKey ? { apiKey: this.apiKey } : {}),
          })
        ).config,
      );
      this.messageKind = 'success';
      this.message = '翻译配置已保存';
    } catch (e) {
      this.messageKind = 'error';
      this.message = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
  async copy() {
    if (!this.copyId || this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      this.accept((await api.saveTranslationSettings({ copyFromConfigId: this.copyId })).config);
      this.messageKind = 'success';
      this.message = '已复制为独立翻译配置';
    } catch (e) {
      this.messageKind = 'error';
      this.message = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
  async remove() {
    this.busy = true;
    this.message = '';
    try {
      await api.deleteTranslationSettings();
      this.accept(null);
      this.messageKind = 'success';
      this.message = '已删除翻译配置，已保存译文仍可查看';
    } catch (e) {
      this.messageKind = 'error';
      this.message = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
  async test() {
    if (this.busy) return;
    this.busy = true;
    this.messageKind = 'info';
    this.message = '正在调用已保存的翻译模型…';
    try {
      const r = await api.testTranslationSettings();
      this.messageKind = r.ok ? 'success' : 'error';
      this.message =
        (r.ok ? '连接测试成功' : '连接测试失败') +
        ` · ${r.usage.usageStatus === 'unknown' ? '用量未知' : `输入 ${r.usage.inputTokens ?? '未知'} / 输出 ${r.usage.outputTokens ?? '未知'} token`}`;
    } catch (e) {
      this.messageKind = 'error';
      this.message = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
}
