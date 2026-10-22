/** 只有当前是链接、且 href 是字符串时才写入草稿。其它情况用空字符串。 */
export function linkDraftHref(state: { link?: unknown; href?: unknown } | null): string {
  return state?.link && typeof state.href === 'string' ? state.href : '';
}
