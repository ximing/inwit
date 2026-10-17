import { createAssistantMessageEventStream, type AssistantMessage, type Context, type JsonObject } from '@earendil-works/pi-ai';
import type { ResolvedModel } from '../llm/pi.js';

/**
 * 确定性模型替身：script 根据当前对话上下文给出下一条助手消息
 * （工具调用或最终文本），按 pi-ai 事件协议推流。用于 agent 任务测试，
 * 不经过网络与真实模型。
 */

export interface FakeToolCall {
  name: string;
  /** 宽松输入；构造事件时断言为 JsonObject（测试夹具不产生非法值）。 */
  arguments: Record<string, unknown>;
}

export interface FakeReply {
  toolCalls?: FakeToolCall[];
  text?: string;
  /** 模拟模型层错误：stopReason=error。 */
  errorMessage?: string;
}

export type FakeModelScript = (context: Context) => FakeReply;

let callSeq = 0;

function assistantMessage(reply: FakeReply): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (reply.text !== undefined) content.push({ type: 'text', text: reply.text });
  for (const call of reply.toolCalls ?? []) {
    callSeq += 1;
    content.push({
      type: 'toolCall',
      id: `fake-call-${String(callSeq)}`,
      name: call.name,
      arguments: call.arguments as JsonObject,
    });
  }
  const isError = reply.errorMessage !== undefined;
  const stopReason = isError ? 'error' : (reply.toolCalls?.length ?? 0) > 0 ? 'toolUse' : 'stop';
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'dashscope',
    model: 'fake-model',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(isError ? { errorMessage: reply.errorMessage } : {}),
    timestamp: Date.now(),
  };
}

/** pi-agent streamFn 替身：同步推送完整事件序列。 */
export function fakeStreamSimple(script: FakeModelScript) {
  return (_model: unknown, context: Context) => {
    const stream = createAssistantMessageEventStream();
    const message = assistantMessage(script(context));
    stream.push({ type: 'start', partial: message });
    message.content.forEach((part, index) => {
      if (part.type === 'text') {
        stream.push({ type: 'text_start', contentIndex: index, partial: message });
        stream.push({ type: 'text_end', contentIndex: index, content: part.text, partial: message });
      } else if (part.type === 'toolCall') {
        stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
        stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: part, partial: message });
      }
    });
    if (message.stopReason === 'error') {
      stream.push({ type: 'error', reason: 'error', error: message });
    } else {
      stream.push({
        type: 'done',
        reason: message.stopReason as 'stop' | 'toolUse',
        message,
      });
    }
    stream.end(message);
    return stream;
  };
}

/** runAgentJob 的 resolveModelFor 替身返回值。 */
export function fakeResolvedModel(script: FakeModelScript): ResolvedModel {
  return {
    models: { streamSimple: fakeStreamSimple(script) } as ResolvedModel['models'],
    model: { id: 'fake-model', maxTokens: 8192 } as ResolvedModel['model'],
    apiKey: 'fake-key',
    provider: 'dashscope',
    modelId: 'fake-model',
    source: 'user',
    configId: null,
  };
}

/** 从对话上下文读取最后一个工具结果（JSON）。 */
export function lastToolResult(context: Context): { name: string; payload: unknown } | null {
  for (let i = context.messages.length - 1; i >= 0; i -= 1) {
    const message = context.messages[i]!;
    if (message.role !== 'toolResult') continue;
    const text = message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');
    try {
      return { name: message.toolName, payload: JSON.parse(text) };
    } catch {
      return { name: message.toolName, payload: text };
    }
  }
  return null;
}
