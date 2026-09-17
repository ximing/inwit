import { describe, expect, it, vi } from 'vitest';
import { AssetMap } from './asset-map';

const A = 'asset:users/demo/pic.png';
const B = 'asset:users/demo/other.png';
const HTTPS = 'https://picsum.photos/seed/inwit/800/480';

describe('AssetMap', () => {
  it('urlFor returns injected https URL and treats null as missing', () => {
    const map = new AssetMap();
    expect(map.urlFor(A)).toBeNull();
    map.inject({ [A]: HTTPS, [B]: null });
    expect(map.urlFor(A)).toBe(HTTPS);
    expect(map.urlFor(B)).toBeNull();
  });

  it('urlFor passes through http(s) srcs without injection', () => {
    const map = new AssetMap();
    expect(map.urlFor(HTTPS)).toBe(HTTPS);
  });

  it('subscribe is notified only when inject changes the map', () => {
    const map = new AssetMap();
    const listener = vi.fn();
    const unsub = map.subscribe(listener);
    map.inject({ [A]: HTTPS });
    expect(listener).toHaveBeenCalledTimes(1);
    map.inject({ [A]: HTTPS });
    expect(listener).toHaveBeenCalledTimes(1);
    map.inject({ [A]: 'https://example.com/b.png' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    map.inject({ [A]: HTTPS });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ensure dedupes srcs, skips known/pending, and emits assetNeeded once', async () => {
    const onNeeded = vi.fn();
    const map = new AssetMap(onNeeded);
    await map.ensure([A, A, B, '', HTTPS]);
    expect(onNeeded).toHaveBeenCalledTimes(1);
    expect(onNeeded).toHaveBeenCalledWith([A, B]);
    await map.ensure([A, B]);
    expect(onNeeded).toHaveBeenCalledTimes(1);
    map.inject({ [A]: HTTPS });
    await map.ensure([A, B]);
    expect(onNeeded).toHaveBeenCalledTimes(1);
    map.inject({ [B]: null });
    await map.ensure([A, B]);
    expect(onNeeded).toHaveBeenCalledTimes(1);
  });

  it('re-emits after inject for a src that was never requested if a new unknown src arrives', async () => {
    const onNeeded = vi.fn();
    const map = new AssetMap(onNeeded);
    await map.ensure([A]);
    map.inject({ [A]: HTTPS });
    await map.ensure([A, B]);
    expect(onNeeded).toHaveBeenNthCalledWith(2, [B]);
  });
});
