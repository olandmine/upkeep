import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-accent bg-accent-muted text-accent hover:text-accent-hover hover:shadow-[0_0_16px_var(--accent-glow)]',
  secondary: 'border border-line-2 bg-elevated text-fg hover:border-line-3',
  ghost: 'text-fg-2 hover:bg-elevated hover:text-fg',
  destructive: 'bg-negative-muted text-negative hover:brightness-125',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** 32×32 icon button; pass an aria-label. */
  icon?: boolean
  /** Compact text button (28px high), for rows in a table. */
  size?: 'sm'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon, size, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'type-label inline-flex shrink-0 items-center justify-center gap-2 rounded-md transition-[color,background-color,border-color,box-shadow] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50',
        icon ? 'size-8' : size === 'sm' ? 'h-7 px-2' : 'h-9 px-3',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
})
