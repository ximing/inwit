import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Chip({
  isOn = false,
  dashed = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  isOn?: boolean;
  dashed?: boolean;
  children?: ReactNode;
}) {
  const classes = ['chip', isOn ? 'is-on' : '', dashed ? 'chip-new' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
