import { useEffect, useRef, useState } from 'react'
import type { SharingLevel } from '../../../shared/sharing'
import { errorMessage } from '../../lib/api'
import { SharingCaveats, SharingLevelOptions } from '../sharing/SharingLevelOptions'
import { Card, CardHeader } from '../ui/Card'
import { useToast } from '../ui/Toast'

// Arrow keys choose each option they pass, so a level only saves once the person has stopped on it.
const SAVE_PAUSE_MS = 300

/** The selection moves straight away, saves after a pause, and goes back if the save fails. */
export function SharingCard({ value, onSave }: { value: SharingLevel | null; onSave: (level: SharingLevel) => Promise<void> }) {
  const toast = useToast()
  const [chosen, setChosen] = useState<SharingLevel | null>(null)
  const waiting = useRef<{ level: SharingLevel; timer: ReturnType<typeof setTimeout> } | null>(null)
  const next = useRef<SharingLevel | null>(null)
  const saving = useRef(false)
  // Read when the pause ends, or as the page goes away, by which time this render's values may be old.
  const latest = useRef({ value, onSave, toast })
  useEffect(() => {
    latest.current = { value, onSave, toast }
  })

  // One save at a time, so an earlier choice can't land after a later one.
  const saveNext = useRef(async () => {
    if (saving.current) return
    saving.current = true
    while (next.current) {
      const level = next.current
      next.current = null
      if (level === latest.current.value) continue
      try {
        await latest.current.onSave(level)
        latest.current.value = level
        latest.current.toast('Sharing updated', 'success')
      } catch (err) {
        latest.current.toast(errorMessage(err), 'error')
      }
    }
    saving.current = false
    if (!waiting.current) setChosen(null)
  })
  const endPause = useRef(() => {
    if (!waiting.current) return
    clearTimeout(waiting.current.timer)
    next.current = waiting.current.level
    waiting.current = null
    void saveNext.current()
  })
  // Leaving the page during the pause still saves the choice.
  useEffect(() => endPause.current, [])

  function choose(level: SharingLevel) {
    setChosen(level)
    if (waiting.current) clearTimeout(waiting.current.timer)
    waiting.current = { level, timer: setTimeout(endPause.current, SAVE_PAUSE_MS) }
  }

  return (
    <Card aria-labelledby="sharing">
      <CardHeader id="sharing" title="Sharing" />
      <div className="flex flex-col gap-4">
        <SharingLevelOptions value={chosen ?? value} onChange={choose} />
        <p className="type-caption text-fg-3">Joint accounts are always shared.</p>
        <SharingCaveats />
      </div>
    </Card>
  )
}
