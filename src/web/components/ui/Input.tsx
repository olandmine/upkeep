import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'type-body h-9 w-full rounded-sm border border-line-2 bg-elevated px-3 text-fg outline-none transition-colors duration-150 placeholder:text-fg-3 hover:border-line-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-muted)] aria-invalid:border-negative',
        className,
      )}
      {...props}
    />
  )
})

/** Label + input + helper/error text, wired for screen readers. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string | null
  hint?: ReactNode
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = useId()
  const helpId = `${id}-help`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label text-fg-2">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? helpId : undefined })}
      {(error || hint) && (
        <p id={helpId} className={cn('type-caption', error ? 'text-negative' : 'text-fg-3')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
