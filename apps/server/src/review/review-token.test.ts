import { describe, expect, it } from 'vitest';
import { issueReviewToken, verifyReviewToken } from './review-token.js';

const BASE = {
  userId: '11111111-1111-4111-8111-111111111111',
  cardId: '22222222-2222-4222-8222-222222222222',
  questionId: '33333333-3333-4333-8333-333333333333',
  reviewRevision: 1,
  bindingId: null,
  epochId: null,
  targetVersion: null,
};

describe('reviewToken', () => {
  it('签发与验签往返', () => {
    const token = issueReviewToken(BASE);
    expect(verifyReviewToken(token)).toEqual({ v: 1, ...BASE });
  });

  it('篡改载荷或签名被拒绝', () => {
    const token = issueReviewToken(BASE);
    const [body, sig] = token.split('.');
    expect(verifyReviewToken(`${body}x.${sig!}`)).toBeNull();
    expect(verifyReviewToken(`${body}.`)).toBeNull();
    expect(verifyReviewToken(`${body}.${sig!}x`)).toBeNull();
    // 改动 body 内容（编码不同 payload）
    const other = issueReviewToken({ ...BASE, reviewRevision: 2 });
    expect(verifyReviewToken(`${other.split('.')[0]}.${sig!}`)).toBeNull();
    expect(verifyReviewToken('')).toBeNull();
    expect(verifyReviewToken('not-a-token')).toBeNull();
  });
});
