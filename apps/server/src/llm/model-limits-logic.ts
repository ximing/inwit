export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

/** Used when the model id is not a known long-context family. */
export const DEFAULT_MODEL_LIMITS: ModelLimits = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
};

/**
 * GLM-5 (including glm-5.3-flash): 1,048,576 context, 131,072 max output.
 * Thinking is always on and counts against the output budget.
 */
export const GLM5_MODEL_LIMITS: ModelLimits = {
  contextWindow: 1_048_576,
  maxOutputTokens: 131_072,
};

/** Current qwen-plus / qwen-flash: 1,000,000 context, 32,768 max output. */
export const QWEN_PLUS_LIMITS: ModelLimits = {
  contextWindow: 1_000_000,
  maxOutputTokens: 32_768,
};

/** qwen3.6 / qwen3.7 plus and flash: 1,000,000 context, at least 65,536 output. */
export const QWEN3_LONG_LIMITS: ModelLimits = {
  contextWindow: 1_000_000,
  maxOutputTokens: 65_536,
};

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function qwenLimits(id: string): ModelLimits | null {
  if (id.startsWith('qwen-plus-character')) return null;
  if (
    id === 'qwen-plus' ||
    id.startsWith('qwen-plus-latest') ||
    id === 'qwen-flash' ||
    id.startsWith('qwen-flash-latest')
  ) {
    return QWEN_PLUS_LIMITS;
  }
  if (
    id.startsWith('qwen3.6-plus') ||
    id.startsWith('qwen3.6-flash') ||
    id.startsWith('qwen3.7-plus') ||
    id.startsWith('qwen3.7-flash')
  ) {
    return QWEN3_LONG_LIMITS;
  }
  return null;
}

/** Context window and max output sent to the provider for an OpenAI-compatible model id. */
export function resolveModelLimits(modelId: string): ModelLimits {
  const id = normalizeModelId(modelId);
  if (id.startsWith('glm-5')) return GLM5_MODEL_LIMITS;
  return qwenLimits(id) ?? DEFAULT_MODEL_LIMITS;
}
