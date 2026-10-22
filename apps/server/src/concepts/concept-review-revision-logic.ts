/**
 * 受管理卡片下一步的 reviewRevision。
 * 各原因沿用原来的算法，不收成同一种 +1。不该变时返回当前值。没有数据库访问。
 */
export type ReviewRevisionCause =
  | { reason: 'rotate' }
  | { reason: 'bind' }
  | { reason: 'refresh' }
  | { reason: 'unbind' }
  | { reason: 'content-edit'; changed: boolean; firstChanged: boolean }
  | { reason: 'create' }
  | { reason: 'resume' };

export function nextReviewRevision(
  current: number | null,
  cause: ReviewRevisionCause,
): number | null {
  switch (cause.reason) {
    case 'rotate':
      // 批量 SQL `reviewRevision + 1`，where 含 `reviewRevision IS NOT NULL`。null 保持 null。
      if (current === null) return null;
      return current + 1;
    case 'bind':
      // 绑定已有卡：`(reviewRevision ?? 0) + 1`。null 变成 1，从而进入受管理。
      return (current ?? 0) + 1;
    case 'refresh':
      // 版本冲突检查之后的当前非空值：`reviewRevision! + 1`。
      return current! + 1;
    case 'unbind':
      // 解绑后不退回 null：`(reviewRevision ?? 0) + 1`。
      return (current ?? 0) + 1;
    case 'content-edit':
      // revision 为 null 则保持 null。仅内容或首题变化时 +1。
      if (current === null) return null;
      if (!cause.changed && !cause.firstChanged) return current;
      return current + 1;
    case 'create':
      // 插入值，忽略当前 revision。
      return 1;
    case 'resume':
      return current;
    default: {
      const unreachable: never = cause;
      return unreachable;
    }
  }
}
