import { AlertDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { Button } from './Button'

/** Destructive actions always confirm. */
export function ConfirmDialog({
  trigger,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode
  description: string
  confirmLabel: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-raised p-6 shadow-float">
          <AlertDialog.Title className="type-heading mb-2">{confirmLabel}</AlertDialog.Title>
          <AlertDialog.Description className="type-body mb-6 text-fg-2">{description}</AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="destructive" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
