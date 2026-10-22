import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: null },
}));

import { ApiError } from '@/api/client';
import { clipReason, decisionError, imageMime, reparentError } from './reader-logic.js';

describe('imageMime', () => {
  it('accepts a known mime, normalizes jpg, and ignores parameters', () => {
    expect(imageMime('file.bin', 'image/png')).toBe('image/png');
    expect(imageMime('file.png', 'image/jpg')).toBe('image/jpeg');
    expect(imageMime('file.png', '  Image/JPEG ; charset=utf-8')).toBe('image/jpeg');
    expect(imageMime('file.png', 'image/gif')).toBe('image/gif');
    expect(imageMime('file.png', 'image/webp')).toBe('image/webp');
  });

  it('falls back to the path extension when the mime is missing or not an image', () => {
    expect(imageMime('https://cdn.example/a.JPG?token=1', null)).toBe('image/jpeg');
    expect(imageMime('/tmp/a.jpeg', undefined)).toBe('image/jpeg');
    expect(imageMime('/tmp/a.PNG?x=1.png', '')).toBe('image/png');
    expect(imageMime('/tmp/a.webp', 'application/octet-stream')).toBe('image/webp');
    expect(imageMime('/tmp/a.GIF', '   ')).toBe('image/gif');
    expect(imageMime('file.txt?name=a.png', 'image/bmp')).toBeNull();
    expect(imageMime('', null)).toBeNull();
  });
});

describe('clipReason', () => {
  it('strips NUL and cuts at 500 code points without splitting an emoji', () => {
    expect(clipReason('原因')).toBe('原因');
    expect(clipReason('a\0b\0')).toBe('ab');
    expect(clipReason('\0'.repeat(10) + '测'.repeat(500) + '尾')).toBe('测'.repeat(500));
    expect(clipReason('测'.repeat(500))).toBe('测'.repeat(500));
    expect(clipReason('a'.repeat(499) + '😀' + 'z')).toBe('a'.repeat(499) + '😀');
    expect([...clipReason('😀'.repeat(501))]).toHaveLength(500);
  });
});

describe('reparentError', () => {
  it('maps placement reasons and falls back for anything else', () => {
    expect(reparentError('cycle')).toBe('不能挂到自己下面的节点');
    expect(reparentError('depth')).toBe('这一层太深了');
    expect(reparentError('self')).toBe('不能挂到自己下面');
    expect(reparentError('missing')).toBe('没法移动');
    expect(reparentError('')).toBe('没法移动');
  });
});

describe('decisionError', () => {
  it('keeps the fixed card-decision copy and otherwise uses the error message', () => {
    expect(decisionError(new ApiError(500, 'CARD_INDEX_FAILED', '原始信息'), 'accept')).toBe(
      '这张卡暂时没能进入检索，请再试',
    );
    expect(decisionError(new ApiError(500, 'CARD_INDEX_FAILED', '原始信息'), 'reject')).toBe(
      '这张卡暂时没能移出检索，请再试',
    );
    expect(decisionError(new ApiError(409, 'DIGEST_IN_PROGRESS', '原始信息'), 'reject')).toBe(
      '消化还在进行，暂时不能确认',
    );
    expect(decisionError(new ApiError(409, 'CARD_ALREADY_REVIEWED', '原始信息'), 'accept')).toBe(
      '请用回收站，而不是「有问题」',
    );
    expect(decisionError(new ApiError(400, 'OTHER', '服务端拒绝了'), 'accept')).toBe('服务端拒绝了');
    expect(decisionError(new Error('网络断了'), 'reject')).toBe('网络断了');
    expect(decisionError(new Error(''), 'accept')).toBe('操作没成功');
    expect(decisionError('nope', 'accept')).toBe('操作没成功');
    expect(decisionError(null, 'reject')).toBe('操作没成功');
  });
});
