/** ~25s / 卡，7 张 ≈ 3 分钟（稿子里的约数）。 */
export function estimateReviewMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil((count * 25) / 60);
}
