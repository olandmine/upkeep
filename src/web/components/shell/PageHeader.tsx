import { useQuery } from '@tanstack/react-query'
import { Menu, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { meQuery } from '../../lib/queries'
import { useScope } from '../../lib/scope'
import { Button } from '../ui/Button'
import { ScopeSwitcher } from './ScopeSwitcher'
import { SidebarContent } from './Sidebar'
import { SyncIndicator } from './SyncIndicator'

function MobileNav() {
  const [open, setOpen] = useState(false)
  const { data: me } = useQuery(meQuery)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" icon aria-label="Open menu" className="md:hidden">
          <Menu aria-hidden size={18} strokeWidth={1.5} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[260px] border-r border-line bg-sunken shadow-float">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" icon aria-label="Close menu" className="absolute top-4 right-3">
              <X aria-hidden size={16} />
            </Button>
          </Dialog.Close>
          <SidebarContent me={me} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function PageHeader({ title, actions, showScope = true }: { title: string; actions?: ReactNode; showScope?: boolean }) {
  const [scope, setScope] = useScope()
  return (
    <header className="mx-auto flex min-h-16 w-full max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 md:px-8">
      <MobileNav />
      <h1 className="type-title mr-auto">{title}</h1>
      <div className="xl:hidden">
        <SyncIndicator />
      </div>
      {actions}
      {showScope && (
        <div className="w-full sm:w-auto">
          <ScopeSwitcher value={scope} onChange={setScope} />
        </div>
      )}
    </header>
  )
}

/** Standard page frame: header, then content at max 1320px with 32px (16px mobile) gutters. */
export function Page({
  title,
  actions,
  showScope,
  children,
}: {
  title: string
  actions?: ReactNode
  showScope?: boolean
  children: ReactNode
}) {
  return (
    <>
      <PageHeader title={title} actions={actions} showScope={showScope} />
      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-4 pb-16 md:px-8">{children}</main>
    </>
  )
}
