import { isAssetSrc, isHttpSrc } from '@/lib/asset-urls-logic';

export type PastedMediaKind = 'image' | 'video';

export type PastedMediaRef = {
  kind: PastedMediaKind;
  /** Attribute text as it appears in the HTML. */
  raw: string;
  /** Decoded, usable src. */
  src: string;
};

export type PasteAction = 'rehost-html' | 'ingest-files' | 'default';

export type DataUrlPayload = {
  mime: string;
  bytes: Uint8Array;
};

export type RehostDeps = {
  storeFile: (file: File) => Promise<string>;
  fetchSrc?: (src: string) => Promise<File | null>;
  importUrl?: (url: string) => Promise<string>;
};

const MEDIA_SRC_RE =
  /<(img|video|source)\b([^>]*?)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function needsRehostSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || isAssetSrc(trimmed)) return false;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('file:')) {
    return true;
  }
  return isHttpSrc(trimmed);
}

export function absoluteMediaSrc(src: string): string {
  const trimmed = src.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

export function collectMediaFromHtml(html: string): PastedMediaRef[] {
  const out: PastedMediaRef[] = [];
  const seen = new Set<string>();
  MEDIA_SRC_RE.lastIndex = 0;
  let match: RegExpExecArray | null = MEDIA_SRC_RE.exec(html);
  while (match) {
    const tag = (match[1] ?? '').toLowerCase();
    const raw = match[3] ?? match[4] ?? match[5] ?? '';
    const src = decodeHtmlAttr(raw).trim();
    if (src && !seen.has(`${tag}:${raw}`)) {
      seen.add(`${tag}:${raw}`);
      out.push({
        kind: tag === 'img' ? 'image' : 'video',
        raw,
        src,
      });
    }
    match = MEDIA_SRC_RE.exec(html);
  }
  return out;
}

export function decidePasteAction(html: string, fileCount: number): PasteAction {
  const media = collectMediaFromHtml(html);
  if (media.some((item) => needsRehostSrc(item.src))) return 'rehost-html';
  if (fileCount > 0 && media.length === 0 && !/<[a-z]/i.test(html)) return 'ingest-files';
  return 'default';
}

export function parseDataUrl(src: string): DataUrlPayload | null {
  const match = /^data:([^;,]+)?([^,]*),(.*)$/i.exec(src.trim());
  if (!match) return null;
  const mime = (match[1] ?? '').trim().toLowerCase() || 'application/octet-stream';
  const extra = match[2] ?? '';
  const data = match[3] ?? '';
  try {
    if (/;base64/i.test(extra)) {
      const bytes = decodeBase64(data.replace(/\s/g, ''));
      if (bytes.length === 0) return null;
      return { mime, bytes };
    }
    const decoded = decodeURIComponent(data);
    if (decoded.length === 0) return null;
    return { mime, bytes: textToBytes(decoded) };
  } catch {
    return null;
  }
}

export function fileFromDataUrl(src: string, basename = 'paste'): File | null {
  const parsed = parseDataUrl(src);
  if (!parsed) return null;
  const ext = MIME_EXT[parsed.mime];
  const name = ext ? `${basename}.${ext}` : basename;
  const copy = new ArrayBuffer(parsed.bytes.byteLength);
  new Uint8Array(copy).set(parsed.bytes);
  return new File([copy], name, { type: parsed.mime });
}

export function rewriteMediaSrcs(html: string, replacements: ReadonlyMap<string, string>): string {
  if (replacements.size === 0) return html;
  const entries = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
  let out = html;
  for (const [from, to] of entries) {
    if (!from || from === to) continue;
    out = replaceSrcValue(out, from, to);
  }
  return out;
}

export async function rehostPastedHtml(
  html: string,
  extraFiles: readonly File[],
  deps: RehostDeps,
): Promise<{ html: string; assetSrcs: string[]; failed: string[] }> {
  const media = collectMediaFromHtml(html);
  const queue = extraFiles.filter((file) => file.size > 0);
  let queueIndex = 0;
  const replacements = new Map<string, string>();
  const assetSrcs: string[] = [];
  const failed: string[] = [];
  const done = new Map<string, string>();

  for (const item of media) {
    if (!needsRehostSrc(item.src)) continue;
    if (replacements.has(item.raw)) continue;
    const cached = done.get(item.src);
    if (cached) {
      replacements.set(item.raw, cached);
      continue;
    }

    const assetSrc = await rehostMediaSrc(item.src, () => {
      const next = queue[queueIndex];
      if (!next) return null;
      queueIndex += 1;
      return next;
    }, deps);

    if (!assetSrc) {
      failed.push(item.src);
      continue;
    }
    done.set(item.src, assetSrc);
    replacements.set(item.raw, assetSrc);
    assetSrcs.push(assetSrc);
  }

  return {
    html: rewriteMediaSrcs(html, replacements),
    assetSrcs,
    failed,
  };
}

export async function rehostMediaSrc(
  src: string,
  takeFile: () => File | null,
  deps: RehostDeps,
): Promise<string | null> {
  const dataFile = fileFromDataUrl(src);
  if (dataFile) {
    try {
      return await deps.storeFile(dataFile);
    } catch {
      return null;
    }
  }

  const absolute = absoluteMediaSrc(src);
  if (deps.fetchSrc && (absolute.startsWith('blob:') || isHttpSrc(absolute))) {
    try {
      const fetched = await deps.fetchSrc(absolute);
      if (fetched) return await deps.storeFile(fetched);
    } catch {
      // Fall through to clipboard bytes / server import.
    }
  }

  const queued = takeFile();
  if (queued) {
    try {
      return await deps.storeFile(queued);
    } catch {
      return null;
    }
  }

  if (deps.importUrl && isHttpSrc(absolute)) {
    try {
      return await deps.importUrl(absolute);
    } catch {
      return null;
    }
  }

  return null;
}

function replaceSrcValue(html: string, from: string, to: string): string {
  const escaped = escapeRegExp(from);
  return html.replace(
    new RegExp(`(\\bsrc\\s*=\\s*)(?:("${escaped}")|('${escaped}')|(${escaped}))`, 'gi'),
    (_whole, prefix: string, double?: string, single?: string) => {
      if (double) return `${prefix}"${to}"`;
      if (single) return `${prefix}'${to}'`;
      return `${prefix}${to}`;
    },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function textToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}
