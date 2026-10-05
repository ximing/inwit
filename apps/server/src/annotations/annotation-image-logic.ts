import { isAssetKey } from '../assets/asset-logic.js';
import { isExcerptKeyFor } from '../documents/excerpt-logic.js';

/**
 * 批注贴图接受两个 key 家族：正文摘录图（`docs/<user>/<doc>/excerpts/…`），
 * 以及文档资源图（`users/<user>/doc-assets/…`，想法贴图与脑图图片节点用它）。
 */
export function isAnnotationImageKeyFor(
  userId: string,
  documentId: string,
  key: string,
): boolean {
  if (isExcerptKeyFor(key, userId, documentId)) return true;
  return isAssetKey(key) && key.startsWith(`users/${userId}/`) && !key.includes('..');
}
