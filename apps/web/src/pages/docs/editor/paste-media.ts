import { classifyAssetFile } from './upload-asset';
import { isHttpSrc } from '@/lib/asset-urls-logic';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function filesFromDataTransfer(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || file.size <= 0) return;
    const key = `${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const file of dt.files) push(file);
  for (const item of dt.items) {
    if (item.kind === 'file') push(item.getAsFile());
  }
  return out;
}

export async function fetchMediaAsFile(src: string): Promise<File | null> {
  if (!src.startsWith('blob:') && !isHttpSrc(src)) return null;
  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = (blob.type.split(';')[0] ?? blob.type).trim().toLowerCase();
    const classified = classifyAssetFile({ type: mime, size: blob.size });
    if (!classified.ok) return null;
    const ext = MIME_EXT[classified.mime] ?? 'bin';
    return new File([blob], `paste.${ext}`, { type: classified.mime });
  } catch {
    return null;
  }
}
