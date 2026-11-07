const W = 100
const H = 32
const PAD = 2

/** A small balance-over-time line, with the target as a dashed line on the same scale. */
export function Sparkline({
  balance,
  target,
  label,
}: {
  balance: number[]
  target: (number | null)[] | null
  label: string
}) {
  const all = [...balance, ...(target ?? [])].filter((v): v is number => v != null)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const n = Math.max(balance.length, target?.length ?? 0)
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  const y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / (max - min)) * (H - PAD * 2))
  const num = (v: number) => Number(v.toFixed(2))

  // A null entry ends the run, so the next point starts a fresh sub-path.
  const line = (values: (number | null)[]) => {
    // One value alone is a dot: a zero-length stroke, which the round cap fills in.
    const present = values.findIndex((v) => v != null)
    if (present >= 0 && values.filter((v) => v != null).length === 1) {
      const at = `${num(x(present))} ${num(y(values[present]!))}`
      return `M${at} L${at}`
    }
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${num(x(i))} ${num(y(v))} `
      pen = true
    })
    return d.trim()
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-8 w-full"
    >
      {target && (
        <path
          d={line(target)}
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinecap={target.filter((v) => v != null).length === 1 ? 'round' : undefined}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={line(balance)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
