import {
  EMPTY_OPEN_MEDIA_REPORT,
  type CreateDocumentInput,
  type Document,
  type OpenCreateDocumentInput,
  type OpenDocument,
  type OpenMediaFailure,
  type OpenMediaReport,
} from '@inwit/dto';
import type { PmJson } from '@inwit/doc-schema';
import { serializePmJSONToMarkdown } from '@inwit/markdown';
import { importAssetFromUrl } from '../assets/asset.service.js';
import { AppError } from '../errors.js';
import type { AuthPrincipal } from '../types.js';
import { htmlToContentJson, markdownToContentJson } from './content-json.js';
import { createDocument, getOwnedDocument, toPublicDocument } from './document.service.js';
import {
  applySrcRewrites,
  buildFinalMarkdown,
  checkOpenTokenRate,
  collectHttpMediaSrcs,
  partitionRehostSrcs,
} from './open-documents-logic.js';

function failureCode(err: unknown): string {
  return err instanceof AppError ? err.code : 'ASSET_IMPORT_FAILED';
}

export async function rehostOpenDocumentMedia(
  userId: string,
  doc: PmJson,
): Promise<{ contentJson: PmJson; media: OpenMediaReport }> {
  const { toRehost, skipped } = partitionRehostSrcs(collectHttpMediaSrcs(doc));
  const failed: OpenMediaFailure[] = skipped.map((src) => ({ src, code: 'ASSET_IMPORT_FAILED' }));
  const rewrites = new Map<string, string>();
  for (const src of toRehost) {
    try {
      const imported = await importAssetFromUrl(userId, src);
      rewrites.set(src, imported.assetSrc);
    } catch (err) {
      failed.push({ src, code: failureCode(err) });
    }
  }
  return {
    contentJson: applySrcRewrites(doc, rewrites),
    media: { rehosted: rewrites.size, failed },
  };
}

export function toOpenDocument(doc: Document, media: OpenMediaReport): OpenDocument {
  return {
    ...doc,
    markdown: serializePmJSONToMarkdown(doc.contentJson),
    media,
  };
}

export async function createOpenDocument(
  user: AuthPrincipal,
  input: OpenCreateDocumentInput,
): Promise<OpenDocument> {
  if (user.accessTokenId === undefined) throw AppError.of(403, 'PAT_REQUIRED');
  checkOpenTokenRate(user.accessTokenId);

  const converted =
    input.markdown !== undefined
      ? markdownToContentJson(buildFinalMarkdown(input.markdown, input.sourceUrl))
      : htmlToContentJson(input.html!, input.sourceUrl);
  const { contentJson, media } = await rehostOpenDocumentMedia(user.id, converted);
  const created = await createDocument(user.id, {
    title: input.title,
    contentJson: contentJson as CreateDocumentInput['contentJson'],
    topicId: input.topicId,
    source: 'api',
  });
  return toOpenDocument(created, media);
}

export async function getOpenDocument(user: AuthPrincipal, id: string): Promise<OpenDocument> {
  if (user.accessTokenId === undefined) throw AppError.of(403, 'PAT_REQUIRED');
  const row = await getOwnedDocument(user.id, id);
  return toOpenDocument(toPublicDocument(row), EMPTY_OPEN_MEDIA_REPORT);
}
