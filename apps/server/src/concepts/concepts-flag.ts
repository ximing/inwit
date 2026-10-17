/** 概念读 API 与入口始终可见。 */
export function conceptsReadable(): boolean {
  return true;
}

/** 概念生成与写入始终开放。 */
export function conceptsWritable(): boolean {
  return true;
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
