import { expect, it, vi } from 'vitest';
import type { DocumentDetail } from '@inwit/dto';
import { getDocument } from '@/api/documents';
import { AssetUrlsService } from '@/services/asset-urls.service';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';
import { DocsImportService } from './docs-import.service';
import { DocsAnnotationsService } from './docs-annotations.service';

vi.mock('@/api/documents', async (original) => ({
  ...await original<typeof import('@/api/documents')>(), getDocument: vi.fn(),
}));
vi.mock('@/api/annotations', () => ({ listDocumentAnnotations: vi.fn(async () => []) }));
vi.mock('@/api/canvas', () => ({ listCanvasNodes: vi.fn(async () => []) }));

it.each(['read', 'edit'] as const)('seeds document image URLs before the %s view is ready', async (mode) => {
  const src = 'asset:users/11111111-1111-4111-8111-111111111111/doc-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  const doc: DocumentDetail = {
    id: 'article', userId: 'user', topicId: null, topicTitle: null, mapNodeId: null,
    title: 'Article', description: null, source: 'api', status: 'digested',
    answer: null, linkHint: null, fileMime: null, pageCount: null, cards: [],
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src } }] }] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    assetUrls: { [src]: 'https://cdn.example/article.png' }, assetUrlsFetchedAt: Date.now(),
  };
  vi.mocked(getDocument).mockResolvedValue(doc);
  const assets = new AssetUrlsService();
  const editor = new EditorService();
  const service = new DocsService();
  const imports = new DocsImportService();
  const annotations = new DocsAnnotationsService();
  vi.spyOn(service, 'resolve').mockImplementation(((token: unknown) => {
    if (token === AssetUrlsService) return assets;
    if (token === EditorService) return editor;
    if (token === DocsImportService) return imports;
    if (token === DocsAnnotationsService) return annotations;
    throw new Error('Unexpected service dependency');
  }) as typeof service.resolve);
  vi.spyOn(editor, 'resolve').mockReturnValue(assets);
  try {
    if (mode === 'read') {
      await service.loadDoc(doc.id);
      expect(service.docError).toBeNull();
      expect(service.doc?.id).toBe(doc.id);
    } else {
      await editor.open(doc.id, null);
      expect(editor.phase).toBe('ready');
    }
    expect(assets.urlFor(src)).toBe('https://cdn.example/article.png');
  } finally {
    service.stopPolling();
    editor.destroy();
    assets.destroy();
    imports.destroy();
    annotations.destroy();
  }
});
