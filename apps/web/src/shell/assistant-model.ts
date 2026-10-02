import type { LlmProvider } from '@inwit/dto';

const STORAGE_KEY = 'inwit-assistant-llm';

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  zhipu: '智谱',
  dashscope: '通义百炼',
};

export const ASSISTANT_SYSTEM_MODEL_LABEL = '系统 · qwen-plus';

export function readAssistantModelId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function writeAssistantModelId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

/** Keep a stored choice when it still exists. Otherwise the default, then the first. */
export function resolveAssistantModelId(
  stored: string | null,
  configs: readonly { id: string; isDefault: boolean }[],
): string | null {
  if (stored && configs.some((item) => item.id === stored)) return stored;
  return configs.find((item) => item.isDefault)?.id ?? configs[0]?.id ?? null;
}

export function assistantModelOptionLabel(
  config: { provider: LlmProvider; model: string; isDefault: boolean },
  configs: readonly { provider: LlmProvider; model: string }[],
): string {
  const sharedName = configs.filter((item) => item.model === config.model).length > 1;
  const base = sharedName ? `${PROVIDER_LABELS[config.provider]} · ${config.model}` : config.model;
  return config.isDefault && configs.length > 1 ? `${base} · 默认` : base;
}
