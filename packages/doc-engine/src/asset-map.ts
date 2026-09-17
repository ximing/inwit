export interface AssetUrlProvider {
  urlFor(src: string): string | null;
  ensure(srcs: string[]): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export type AssetNeededHandler = (srcs: string[]) => void;

function isHttpSrc(src: string): boolean {
  try {
    const parsed = new URL(src);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function uniqueNonEmpty(srcs: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const src of srcs) {
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

/**
 * WebView 侧 URL map：不做网络请求。
 * `ensure` 收集未知 src → `assetNeeded` 出桥；`inject` 回填后通知 NodeView。
 */
export class AssetMap implements AssetUrlProvider {
  #urls = new Map<string, string | null>();
  #pending = new Set<string>();
  #listeners = new Set<() => void>();
  #onNeeded: AssetNeededHandler;

  constructor(onNeeded: AssetNeededHandler = () => undefined) {
    this.#onNeeded = onNeeded;
  }

  urlFor(src: string): string | null {
    if (!src) return null;
    if (this.#urls.has(src)) {
      const mapped = this.#urls.get(src);
      return mapped && mapped.length > 0 ? mapped : null;
    }
    if (isHttpSrc(src)) return src;
    return null;
  }

  async ensure(srcs: string[]): Promise<void> {
    const needed: string[] = [];
    for (const src of uniqueNonEmpty(srcs)) {
      if (this.urlFor(src)) continue;
      if (this.#urls.has(src)) continue;
      if (this.#pending.has(src)) continue;
      needed.push(src);
    }
    if (needed.length === 0) return;
    for (const src of needed) this.#pending.add(src);
    this.#onNeeded(needed);
  }

  inject(urls: Record<string, string | null>): void {
    let changed = false;
    for (const [src, raw] of Object.entries(urls)) {
      if (!src) continue;
      const next = raw && raw.length > 0 ? raw : null;
      const prev = this.#urls.has(src) ? (this.#urls.get(src) ?? null) : undefined;
      this.#pending.delete(src);
      if (prev !== next) {
        this.#urls.set(src, next);
        changed = true;
      }
    }
    if (changed) this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
