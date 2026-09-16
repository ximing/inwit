import {
  buildOcrChatBody,
  ocrChatCompletionsUrl,
  parseOcrChatResponse,
  redactSecret,
  type OcrBuiltinTask,
} from './ocr-logic.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface OcrPageResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function usageFromResponse(json: unknown): Pick<OcrPageResult, 'promptTokens' | 'completionTokens' | 'totalTokens'> {
  const usage =
    json !== null && typeof json === 'object' && 'usage' in json
      ? (json as { usage?: unknown }).usage
      : undefined;
  if (usage === null || typeof usage !== 'object') {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  const rec = usage as Record<string, unknown>;
  const promptTokens = usageNumber(rec.prompt_tokens ?? rec.input_tokens);
  const completionTokens = usageNumber(rec.completion_tokens ?? rec.output_tokens);
  const totalTokens = usageNumber(rec.total_tokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export async function completeOcrPage(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  imageDataUrl: string;
  task?: OcrBuiltinTask;
  timeoutMs?: number;
}): Promise<OcrPageResult> {
  const url = ocrChatCompletionsUrl(input.baseUrl);
  const body = buildOcrChatBody({
    model: input.model,
    imageDataUrl: input.imageDataUrl,
    ...(input.task !== undefined ? { task: input.task } : {}),
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(redactSecret(message, input.apiKey));
  }

  const raw = await res.text();
  const redacted = redactSecret(raw, input.apiKey);
  if (!res.ok) {
    throw new Error(`ocr http ${res.status}: ${redacted.slice(0, 800)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`ocr response is not json: ${redacted.slice(0, 200)}`);
  }
  try {
    const text = parseOcrChatResponse(json);
    return { text, ...usageFromResponse(json) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(redactSecret(message, input.apiKey));
  }
}
