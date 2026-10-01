import type { PmJson } from '@inwit/doc-schema';
import { ASSET_RESOLVE_MAX_SRCS } from '@inwit/dto';
import { isAssetSrc } from '../assets/asset-logic.js';
import { presignGet } from '../storage/client.js';
import { logger } from '../utils/logger.js';

/** Prepare display URLs without putting expiring signatures into editable document content. */
export async function resolveDocumentAssets(
  userId: string,
  content: PmJson,
): Promise<{ assetUrls: Record<string, string>; assetUrlsFetchedAt: number }> {
  const srcs = new Set<string>();
  const visit = (node: PmJson): void => {
    if (node.type === 'image' || node.type === 'video') {
      for (const value of [node.attrs?.src, node.attrs?.poster]) {
        if (typeof value === 'string' && isAssetSrc(value) &&
            value.startsWith(`asset:users/${userId}/doc-assets/`)) srcs.add(value);
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);

  const assetUrlsFetchedAt = Date.now();
  const assetUrls: Record<string, string> = {};
  const unique = [...srcs];
  for (let i = 0; i < unique.length; i += ASSET_RESOLVE_MAX_SRCS) {
    await Promise.all(unique.slice(i, i + ASSET_RESOLVE_MAX_SRCS).map(async (src) => {
      try {
        assetUrls[src] = await presignGet(src.slice('asset:'.length));
      } catch (err) {
        // A broken asset must not prevent the rest of the document from opening.
        logger.warn('Could not sign document asset', err);
      }
    }));
  }
  return { assetUrls, assetUrlsFetchedAt };
}
