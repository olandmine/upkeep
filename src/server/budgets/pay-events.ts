import { addDays, type LocalDate } from './dates'

export interface PayDeposit {
  txId: string
  localDate: LocalDate
  amountCents: number
}

export interface DerivedPayEvent {
  payDate: LocalDate
  source: 'detected' | 'scheduled'
  txId: string | null
  amountCents: number | null
  extraTxIds: string[]
}

// Windows around the expected payday E = prev + frequency.
const EXTRA_WINDOW_DAYS = 9
const ON_TIME_GRACE_DAYS = 2
const LATE_ATTACH_DAYS = 5

/**
 * Pay events from matching deposits (sorted ascending). Pure: depends only on the
 * deposits and `today`, and an event's payDate never moves once it exists.
 */
export function derivePayEvents(
  deposits: PayDeposit[],
  today: LocalDate,
  frequencyDays = 14,
): DerivedPayEvent[] {
  if (deposits.length === 0) return []
  const [first, ...rest] = deposits
  const events: DerivedPayEvent[] = [
    {
      payDate: first.localDate,
      source: 'detected',
      txId: first.txId,
      amountCents: first.amountCents,
      extraTxIds: [],
    },
  ]
  const current = () => events[events.length - 1]
  const expected = () => addDays(current().payDate, frequencyDays)
  const placeholder = (payDate: LocalDate): DerivedPayEvent => ({
    payDate,
    source: 'scheduled',
    txId: null,
    amountCents: null,
    extraTxIds: [],
  })

  for (const d of rest) {
    for (;;) {
      const cur = current()
      const due = expected()
      if (d.localDate < addDays(cur.payDate, EXTRA_WINDOW_DAYS)) {
        if (cur.txId === null) {
          cur.txId = d.txId
          cur.amountCents = d.amountCents
        } else {
          cur.extraTxIds.push(d.txId)
        }
      } else if (d.localDate <= addDays(due, ON_TIME_GRACE_DAYS)) {
        events.push({
          payDate: d.localDate,
          source: 'detected',
          txId: d.txId,
          amountCents: d.amountCents,
          extraTxIds: [],
        })
      } else if (d.localDate <= addDays(due, LATE_ATTACH_DAYS)) {
        events.push({
          payDate: due,
          source: 'scheduled',
          txId: d.txId,
          amountCents: d.amountCents,
          extraTxIds: [],
        })
      } else {
        events.push(placeholder(due))
        continue
      }
      break
    }
  }

  while (today > addDays(expected(), ON_TIME_GRACE_DAYS)) events.push(placeholder(expected()))
  return events
}
