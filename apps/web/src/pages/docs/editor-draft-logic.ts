import type { PmDocJson } from '@inwit/dto';

interface BodyDirtyCache {
  draft: PmDocJson | null;
  saved: PmDocJson | null;
  differs: boolean;
}

const caches = new WeakMap<object, BodyDirtyCache>();

function cacheOf(host: object): BodyDirtyCache {
  let cache = caches.get(host);
  if (!cache) {
    cache = { draft: null, saved: null, differs: false };
    caches.set(host, cache);
  }
  return cache;
}

/**
 * Whether the draft body differs from the saved body.
 * A keystroke replaces only the draft object. Once that body is known to
 * differ, later keystrokes skip the deep compare. Pass force when the answer
 * must notice an undo back to the saved body (the debounced save does this).
 * `host` is the raw service; the cache is kept off the reactive instance.
 */
export function cachedBodyDiffers(
  host: object,
  draft: PmDocJson,
  saved: PmDocJson,
  equal: (left: PmDocJson, right: PmDocJson) => boolean,
  force = false,
): boolean {
  const cache = cacheOf(host);
  if (!force && draft === cache.draft && saved === cache.saved) return cache.differs;
  if (!force && cache.differs && saved === cache.saved && cache.draft !== null) {
    cache.draft = draft;
    return true;
  }
  const differs = !equal(draft, saved);
  cache.draft = draft;
  cache.saved = saved;
  cache.differs = differs;
  return differs;
}
