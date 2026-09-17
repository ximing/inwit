import { useService } from '@rabjs/react';
import { useCallback, type RefObject } from 'react';
import { AssetUrlsService } from '@/services/asset-urls.service';
import type { DocEngineHandle } from './DocEngineView';

export function useDocEngineAssets(engineRef: RefObject<DocEngineHandle | null>) {
  const assets = useService(AssetUrlsService);

  return useCallback(
    async (srcs: string[]) => {
      await assets.ensure(srcs);
      const urls: Record<string, string | null> = {};
      for (const src of srcs) urls[src] = assets.urlFor(src);
      engineRef.current?.injectAssetUrls(urls);
    },
    [assets, engineRef],
  );
}
