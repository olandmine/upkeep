import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-lg border border-line bg-raised p-6 shadow-[inset_0_1px_0_var(--highlight-top)]', className)}
      {...props}
    />
  )
}

export function CardHeader({ title, action, id }: { title: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 id={id} className="type-heading">
        {title}
      </h2>
      {action}
    </div>
  )
}
