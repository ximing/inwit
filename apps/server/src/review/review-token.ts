import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';

/**
 * 受管理卡的复习令牌：服务端在今日队列签发，反馈时必须原样回传。
 * 只携带版本坐标（userId/cardId/questionId/reviewRevision 与活动绑定归属），
 * 不包含题目或答案。任何内容/绑定变化都使旧令牌失效。
 */

const reviewTokenPayloadSchema = z.object({
  v: z.literal(1),
  userId: z.string().uuid(),
  cardId: z.string().uuid(),
  questionId: z.string().uuid(),
  reviewRevision: z.number().int().positive(),
  bindingId: z.string().uuid().nullable(),
  epochId: z.string().uuid().nullable(),
  targetVersion: z.number().int().positive().nullable(),
});
export type ReviewTokenPayload = z.infer<typeof reviewTokenPayloadSchema>;

function sign(payloadB64: string): string {
  return createHmac('sha256', config.JWT_SECRET).update(payloadB64).digest('base64url');
}

export function issueReviewToken(
  payload: Omit<ReviewTokenPayload, 'v'>,
): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload }), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** 验签并解析；任何篡改/格式错误返回 null。 */
export function verifyReviewToken(token: string): ReviewTokenPayload | null {
  const split = token.lastIndexOf('.');
  if (split <= 0) return null;
  const body = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = reviewTokenPayloadSchema.safeParse(
      JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
