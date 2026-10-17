import { config } from '../config.js';

/**
 * 概念读 API 与入口是否可见。
 * CONCEPTS_READ_ENABLED 已设置时用它，否则跟随 CONCEPTS_ENABLED。
 */
export function conceptsReadable(): boolean {
  if (config.CONCEPTS_READ_ENABLED !== undefined) return config.CONCEPTS_READ_ENABLED;
  return config.CONCEPTS_ENABLED;
}

/**
 * 是否接受新生成与写入。读关闭时写强制关闭。
 * CONCEPTS_WRITE_ENABLED 已设置时用它，否则跟随 CONCEPTS_ENABLED。
 */
export function conceptsWritable(): boolean {
  if (!conceptsReadable()) return false;
  if (config.CONCEPTS_WRITE_ENABLED !== undefined) return config.CONCEPTS_WRITE_ENABLED;
  return config.CONCEPTS_ENABLED;
}

/** GET /health。conceptsEnabled 是入口与读 API；conceptsWritable 是新生成与写入。 */
export function healthStatus(): {
  ok: true;
  conceptsEnabled: boolean;
  conceptsWritable: boolean;
} {
  return {
    ok: true,
    conceptsEnabled: conceptsReadable(),
    conceptsWritable: conceptsWritable(),
  };
}
