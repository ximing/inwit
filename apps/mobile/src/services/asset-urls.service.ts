import { Service } from '@rabjs/react';
import { resolveAssetUrls } from '@/api/assets';
import {
  chunkSrcs,
  liveAssetUrl,
  markResolveFailure,
  mergeResolvedUrls,
  partitionInFlight,
  srcsNeedingResolve,
  type AssetUrlCache,
} from '@/lib/asset-urls-logic';

export class AssetUrlsService extends Service {
  cache: AssetUrlCache = {};
  #inFlight = new Map<string, Promise<void>>();
  #listeners = new Set<() => void>();

  urlFor(src: string): string | null {
    return liveAssetUrl(src, this.cache);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async ensure(srcs: string[]): Promise<void> {
    const needed = srcsNeedingResolve(srcs, this.cache);
    if (needed.length === 0) return;

    const { toFetch, waiting } = partitionInFlight(needed, new Set(this.#inFlight.keys()));
    const jobs: Promise<void>[] = [];
    for (const src of waiting) {
      const job = this.#inFlight.get(src);
      if (job) jobs.push(job);
    }
    if (toFetch.length > 0) jobs.push(this.#fetch(toFetch));
    if (jobs.length === 0) return;
    await Promise.all(jobs);
  }

  override destroy(): void {
    this.#listeners.clear();
    this.#inFlight.clear();
    super.destroy();
  }

  #fetch(srcs: string[]): Promise<void> {
    const job = this.#resolveAll(srcs).finally(() => {
      for (const src of srcs) this.#inFlight.delete(src);
    });
    for (const src of srcs) this.#inFlight.set(src, job);
    return job;
  }

  async #resolveAll(srcs: string[]): Promise<void> {
    let next = this.cache;
    let changed = false;
    for (const group of chunkSrcs(srcs)) {
      const fetchedAt = Date.now();
      try {
        const { urls } = await resolveAssetUrls({ srcs: group });
        next = mergeResolvedUrls(next, urls, fetchedAt);
        const missing = group.filter((src) => {
          const url = urls[src];
          return typeof url !== 'string' || url.length === 0;
        });
        if (missing.length > 0) next = markResolveFailure(next, missing, fetchedAt);
        changed = true;
      } catch {
        next = markResolveFailure(next, group, Date.now());
        changed = true;
      }
    }
    if (!changed) return;
    this.cache = next;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
