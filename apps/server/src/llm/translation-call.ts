import { contentText } from '@earendil-works/pi-ai';
import type { TranslationModelSnapshot, TranslationUsage } from '@inwit/dto';
import { resolvedOf } from './pi.js';
import {
  mergeProviderUsage,
  TRANSLATION_SYSTEM_PROMPT,
  UNKNOWN_TRANSLATION_USAGE,
} from './translation-call-logic.js';
export interface TranslationCallResult extends TranslationUsage {
  status: 'succeeded' | 'failed' | 'unknown';
  text?: string;
  errorCode?: string;
}
/** Single SDK call, with raw transport observation because the SDK normalizes missing usage to zero. */
export async function completeTranslation(
  snapshot: TranslationModelSnapshot,
  apiKey: string,
  sourceText: string,
  contextText = '',
  onDraft?: (text: string) => void,
): Promise<TranslationCallResult> {
  let usage: TranslationUsage = { ...UNKNOWN_TRANSLATION_USAGE };
  let requested = false;
  let responseStatus: number | undefined;
  try {
    const resolved = await resolvedOf(
      snapshot.provider,
      snapshot.model,
      apiKey,
      snapshot.baseUrl,
      'user',
      snapshot.configId,
    );
    // Completion tokens may include hidden reasoning. A short source does not imply a
    // small output budget; use the model's effective capability, bounded by context.
    const estimate = (s: string) =>
      Math.ceil(
        (s.match(/[\x00-\x7F]/g)?.length ?? 0) / 3 + (s.match(/[^\x00-\x7F]/gu)?.length ?? 0) * 1.5,
      );
    const inputTokens = (context: string) =>
      estimate(JSON.stringify({ context, target: sourceText })) +
      estimate(TRANSLATION_SYSTEM_PROMPT) +
      128;
    const requiredInput = inputTokens('');
    const maxTokens = Math.min(
      resolved.model.maxTokens,
      resolved.model.contextWindow - requiredInput,
    );
    if (maxTokens <= 0)
      return { status: 'failed', errorCode: 'PDF_TRANSLATION_CONTEXT_TOO_LARGE', ...usage };
    // Neighboring context is optional; never reduce the answer/reasoning allowance for it.
    if (inputTokens(contextText) + maxTokens > resolved.model.contextWindow) contextText = '';
    const observedFetch: typeof fetch = async (input, init) => {
      // A provider adapter must never silently retry a charged HTTP request.
      if (requested) throw new Error('PDF_TRANSLATION_REDISPATCH_BLOCKED');
      requested = true;
      const response = await fetch(input, { ...init, redirect: 'error' });
      responseStatus = response.status;
      if (!response.body) return response;
      let pending = '';
      const decoder = new TextDecoder();
      const inspect = (line: string) => {
        const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
        if (!raw || raw === '[DONE]') return;
        try {
          usage = mergeProviderUsage(usage, JSON.parse(raw));
        } catch {
          /* SSE event and partial JSON lines contain no usage. */
        }
      };
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            pending += decoder.decode(chunk, { stream: true });
            let i;
            while ((i = pending.indexOf('\n')) >= 0) {
              inspect(pending.slice(0, i));
              pending = pending.slice(i + 1);
            }
            controller.enqueue(chunk);
          },
          flush() {
            pending += decoder.decode();
            inspect(pending);
          },
        }),
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    const invoke = onDraft
      ? resolved.models.streamSimple.bind(resolved.models)
      : resolved.models.completeSimple.bind(resolved.models);
    const output = invoke(
      resolved.model,
      {
        systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ context: contextText, target: sourceText }),
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, signal: AbortSignal.timeout(60_000), maxTokens, fetch: observedFetch },
    );
    if (onDraft) {
      const pieces = new Map<number, string>();
      for await (const event of output as import('@earendil-works/pi-ai').AssistantMessageEventStream) {
        if (event.type === 'text_delta')
          pieces.set(event.contentIndex, (pieces.get(event.contentIndex) ?? '') + event.delta);
        else if (event.type === 'text_end') pieces.set(event.contentIndex, event.content);
        else continue;
        // Do not retain SDK partial objects: they mutate as the response grows.
        onDraft?.(
          [...pieces.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, text]) => text)
            .join(''),
        );
      }
    }
    const response = onDraft
      ? await (output as import('@earendil-works/pi-ai').AssistantMessageEventStream).result()
      : ((await output) as import('@earendil-works/pi-ai').AssistantMessage);
    if (response.stopReason === 'length')
      return { status: 'failed', errorCode: 'LLM_OUTPUT_TRUNCATED', ...usage };
    if (response.stopReason === 'aborted')
      return { status: 'unknown', errorCode: 'LLM_TIMEOUT', ...usage };
    if (response.stopReason === 'error')
      return {
        status:
          responseStatus && responseStatus >= 400 ? 'failed' : requested ? 'unknown' : 'failed',
        errorCode:
          responseStatus === 401 || responseStatus === 403 ? 'LLM_AUTH_FAILED' : 'LLM_UNAVAILABLE',
        ...usage,
      };
    const text = contentText(response.content).trim();
    if (!text || response.stopReason !== 'stop')
      return { status: 'failed', errorCode: 'PDF_TRANSLATION_INVALID_OUTPUT', ...usage };
    return { status: 'succeeded', text, ...usage };
  } catch {
    return { status: requested ? 'unknown' : 'failed', errorCode: 'LLM_UNAVAILABLE', ...usage };
  }
}
