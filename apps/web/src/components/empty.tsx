import type { ReactNode } from 'react';

export function Empty({ children, className }: { children?: ReactNode; className?: string }) {
  const classes = ['empty', className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
