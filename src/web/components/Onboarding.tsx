import type { ReactNode } from 'react'

/** Where the marketing aesthetic lives (serif headline, soft glow, one primary CTA). */
export function Onboarding({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main
      className="flex min-h-dvh items-center justify-center px-4 py-12"
      style={{
        background:
          'radial-gradient(600px 400px at 70% 20%, rgba(76,141,255,0.14), transparent 70%), radial-gradient(500px 360px at 20% 85%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%), var(--bg-base)',
      }}
    >
      <div className="w-full max-w-sm">
        <p className="type-caption mb-6 tracking-[0.2em] text-fg-3 uppercase">Upkeep</p>
        <h1 className="mb-2 font-serif text-[44px] leading-[48px] font-normal text-fg">{title}</h1>
        {subtitle && <p className="mb-8 text-[15px] leading-6 text-fg-2">{subtitle}</p>}
        {children}
      </div>
    </main>
  )
}
