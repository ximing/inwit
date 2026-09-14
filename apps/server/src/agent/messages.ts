import { contentText, type AssistantMessage } from '@earendil-works/pi-ai';

export function isAssistantMessage(message: unknown): message is AssistantMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (message as { role?: unknown }).role === 'assistant' &&
    'usage' in message
  );
}

/** Concatenate non-empty assistant text turns (skip tool-only messages). */
export function extractAssistantText(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (!isAssistantMessage(message)) continue;
    const text = contentText(message.content).trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n\n').trim();
}
