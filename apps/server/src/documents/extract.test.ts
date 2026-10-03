import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { PmJson } from '@inwit/doc-schema';
import { AppError } from '../errors.js';
import { documentPlainText } from './content-json.js';
import { DEFAULT_EPUB_LIMITS, extractImported } from './extract.js';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
    <dc:title>石头记</dc:title>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="nav" linear="no"/>
    <itemref idref="chap2"/>
  </spine>
</package>`;

function chapter(title: string, body: string, extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body><h1>${title}</h1><p>${body}</p>${extra}</body>
</html>`;
}

async function sampleEpub(options?: { nav?: boolean }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', OPF);
  zip.file(
    'OEBPS/chap1.xhtml',
    chapter('第一章', '甄士隐梦幻识通灵', '<p><img src="cover.png" alt="cover"/></p>'),
  );
  if (options?.nav !== false) zip.file('OEBPS/nav.xhtml', chapter('目录', '目录不要出现'));
  zip.file('OEBPS/chap2.xhtml', chapter('第二章', '贾雨村风尘怀闺秀'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function typesIn(node: PmJson, acc: string[] = []): string[] {
  acc.push(node.type);
  for (const child of node.content ?? []) typesIn(child, acc);
  return acc;
}

describe('extractImported epub', () => {
  it('keeps chapter headings in spine order and drops the non-linear nav', async () => {
    const extracted = await extractImported(await sampleEpub(), 'epub');
    const text = documentPlainText(extracted.contentJson);
    expect(extracted.suggestedTitle).toBe('石头记');
    expect(extracted.pageCount).toBeNull();
    expect(text.indexOf('甄士隐梦幻识通灵')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('甄士隐梦幻识通灵')).toBeLessThan(text.indexOf('贾雨村风尘怀闺秀'));
    expect(text).not.toContain('目录不要出现');
    const types = typesIn(extracted.contentJson ?? { type: 'doc' });
    expect(types).toContain('heading');
    expect(types).toContain('pageBreak');
    expect(types).not.toContain('image');
  });

  it('still reads chapters when the nav document is missing', async () => {
    const extracted = await extractImported(await sampleEpub({ nav: false }), 'epub');
    const text = documentPlainText(extracted.contentJson);
    expect(text).toContain('甄士隐梦幻识通灵');
    expect(text).toContain('贾雨村风尘怀闺秀');
    expect(extracted.suggestedTitle).toBe('石头记');
  });

  it('rejects a file that is not an epub', async () => {
    await expect(extractImported(Buffer.from('not an epub'), 'epub')).rejects.toMatchObject({
      status: 422,
      code: 'IMPORT_PARSE_FAILED',
    } satisfies Partial<AppError>);
  });

  it('rejects a spine or chapter that exceeds the limit', async () => {
    const epub = await sampleEpub();
    await expect(
      extractImported(epub, 'epub', { ...DEFAULT_EPUB_LIMITS, maxSpineItems: 2 }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' } satisfies Partial<AppError>);
    await expect(
      extractImported(epub, 'epub', { ...DEFAULT_EPUB_LIMITS, maxHtmlChars: 20 }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' } satisfies Partial<AppError>);
  });
});

describe('extractImported txt', () => {
  it('decodes GB18030 into markdown text', async () => {
    const bytes = Buffer.from('d1a7cfb0b1cabcc7', 'hex');
    const extracted = await extractImported(bytes, 'txt');
    expect(extracted.markdown).toBe('学习笔记');
    expect(extracted.textEncoding).toBe('gb18030');
    expect(extracted.contentJson).toBeUndefined();
  });
});
