import type { ReactNode } from 'react';

export type TagTone = 'topic' | 'ai' | 'done' | 'busy' | 'fail';

export function Tag({
  tone = 'topic',
  className,
  children,
}: {
  tone?: TagTone;
  className?: string;
  children?: ReactNode;
}) {
  const classes = ['tag', `tag-${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}
