import { Toast as T } from 'radix-ui'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Tone = 'error' | 'success' | 'info'
interface Item {
  id: number
  message: string
  tone: Tone
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const show = useCallback((message: string, tone: Tone = 'info') => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), message, tone }])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      <T.Provider swipeDirection="right" duration={6000}>
        {children}
        {items.map((item) => (
          <T.Root
            key={item.id}
            onOpenChange={(open) => !open && setItems((prev) => prev.filter((i) => i.id !== item.id))}
            className={cn(
              'type-body rounded-md border bg-elevated px-4 py-3 text-fg shadow-float',
              item.tone === 'error' ? 'border-negative/40' : item.tone === 'success' ? 'border-positive/40' : 'border-line-2',
            )}
          >
            <T.Description>{item.message}</T.Description>
          </T.Root>
        ))}
        <T.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 outline-none" />
      </T.Provider>
    </ToastContext.Provider>
  )
}
