import { ASSET_IMAGE_MIMES } from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import { clipChars } from '@/lib/clip';

const IMAGE_MIMES = new Set<string>(ASSET_IMAGE_MIMES);

export function imageMime(uri: string, mimeType?: string | null): string | null {
  if (mimeType) {
    const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    const normalized = mime === 'image/jpg' ? 'image/jpeg' : mime;
    if (IMAGE_MIMES.has(normalized)) return normalized;
  }
  const lower = uri.split('?')[0]?.toLowerCase() ?? '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

export function clipReason(reason: string): string {
  return clipChars(reason.replaceAll('\0', ''), 500);
}

export function reparentError(reason: string): string {
  if (reason === 'cycle') return '不能挂到自己下面的节点';
  if (reason === 'depth') return '这一层太深了';
  if (reason === 'self') return '不能挂到自己下面';
  return '没法移动';
}

export function decisionError(err: unknown, action: 'accept' | 'reject'): string {
  if (err instanceof ApiError) {
    if (err.code === 'CARD_INDEX_FAILED') {
      return action === 'accept'
        ? '这张卡暂时没能进入检索，请再试'
        : '这张卡暂时没能移出检索，请再试';
    }
    if (err.code === 'DIGEST_IN_PROGRESS') return '消化还在进行，暂时不能确认';
    if (err.code === 'CARD_ALREADY_REVIEWED') return '请用回收站，而不是「有问题」';
  }
  return errorMessage(err, '操作没成功');
}
