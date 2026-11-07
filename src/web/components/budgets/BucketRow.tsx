import { PlainLink, type LinkLike } from '../AppLink'
import { cn } from '../../lib/cn'
import type { Bucket } from '../../lib/pay-view'
import { Money } from '../Money'
import { Dot } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { money } from './format'

/** What a row needs while amounts are being edited. */
export interface RowEdit {
  /** The slider's top end, in cents. */
  max: number
  /** The number box's text. */
  text: string
  invalid: boolean
  /** The amount saved now, shown as "Was $X" once the row differs from it; null while unchanged. */
  was: number | null
  onSlide: (cents: number) => void
  onText: (text: string) => void
  /** Opens the rest: name, categories, Saver and Remove. */
  onMore: () => void
}

interface Props {
  bucket: Bucket
  /** Set while editing: amounts become inputs, and moved status and the link go away. */
  edit?: RowEdit | null
  /** Where the row goes; rows with nothing to open (plain amounts) have none. */
  href: string | null
  /** How far through the pay we are, as a percent; null hides the pace tick (past pays). */
  pacePercent: number | null
  /** Standard pay: `shown` replaces spent and left with the usual figure and what's spare; `hidden` leaves the amount only. Undefined is This pay. */
  usual?: 'shown' | 'hidden'
  LinkComponent?: LinkLike
}

const MOVED = {
  done: { text: 'Moved ✓', tone: 'text-positive' },
  partial: { text: '', tone: 'text-info' },
  pending: { text: 'Not moved yet', tone: 'text-fg-3' },
} as const

/** The left-hand figure: what's left for a limit, how far along for a Saver. */
function Status({ bucket }: { bucket: Bucket }) {
  if (bucket.kind === 'saver') {
    if (!bucket.moved) return null
    const { check, movedCents } = bucket.moved
    const text = check === 'partial' ? `${money(movedCents)} of ${money(bucket.amountCents ?? 0)} moved` : MOVED[check].text
    return <span className={MOVED[check].tone}>{text}</span>
  }
  if (bucket.kind === 'shared-other') return <span className="text-fg-3">{`${money(bucket.spentCents ?? 0)} spent`}</span>
  if (bucket.kind === 'plain') return null
  const left = bucket.leftCents ?? 0
  if (bucket.state === 'over') return <span className="text-negative">{`Over by ${money(-left)}`}</span>
  return (
    <span className={cn('inline-flex items-center gap-1', bucket.state === 'warning' ? 'text-warning' : 'text-fg')}>
      {bucket.state === 'warning' && <span aria-hidden>⚠</span>}
      {`${money(left)} left`}
    </span>
  )
}

/** Standard pay's left-hand figure: the usual spend. */
function UsualStatus({ bucket }: { bucket: Bucket }) {
  if (bucket.kind === 'plain' || bucket.kind === 'saver' || bucket.spentCents === null) return null
  return <span className="text-fg">{`Usually ${money(bucket.spentCents)}`}</span>
}

/** Standard pay's right-hand figure: a prediction, so over a limit is a warning, not an overspend. */
function UsualSpare({ bucket }: { bucket: Bucket }) {
  if (bucket.kind === 'plain' || bucket.kind === 'saver' || bucket.kind === 'shared-other' || bucket.leftCents === null) return null
  const left = bucket.leftCents
  if (bucket.state === 'over') return <span className="text-warning">{`${money(-left)} over`}</span>
  return <span className="text-fg-3">{`${money(left)} spare`}</span>
}

/** Spent against the amount, with the pace tick and the over-limit extension. */
function Meter({ bucket, pacePercent, usual }: { bucket: Bucket; pacePercent: number | null; usual: boolean }) {
  const width = Math.min(Math.max(bucket.percent, 0), 100)
  return (
    <div
      role="meter"
      aria-label={usual ? `${bucket.name} usually spent` : `${bucket.name} spent`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      className="relative mt-1.5 h-1.5 rounded-full bg-elevated"
    >
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: `var(--${bucket.colorToken})` }} />
      {bucket.state === 'over' && (
        <>
          <span aria-hidden className="absolute top-[-2px] right-0 h-2.5 w-px bg-fg-3" />
          <span aria-hidden className={cn('absolute top-0 left-full h-full w-0.5 rounded-r-full', usual ? 'bg-warning' : 'bg-negative')} />
        </>
      )}
      {pacePercent !== null && (
        <span
          data-testid="pace-tick"
          aria-hidden
          className="absolute top-[-3px] h-3 border-l border-dashed border-fg-3"
          style={{ left: `${pacePercent}%` }}
        />
      )}
    </div>
  )
}

const errorId = (bucket: Bucket) => `${bucket.key}-error`

/** The slider shows the nearest $5, but only dragging it changes the amount. */
function AmountSlider({ bucket, edit }: { bucket: Bucket; edit: RowEdit }) {
  const cents = bucket.amountCents ?? 0
  return (
    <input
      type="range"
      aria-label={`${bucket.name} amount slider`}
      min={0}
      max={edit.max}
      step={500}
      value={Math.min(Math.round(cents / 500) * 500, edit.max)}
      onChange={(e) => edit.onSlide(Number(e.target.value))}
      className="block h-6 w-full cursor-pointer"
      style={{ accentColor: `var(--${bucket.colorToken})` }}
    />
  )
}

function AmountBox({ bucket, edit }: { bucket: Bucket; edit: RowEdit }) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        aria-label={`${bucket.name} amount in dollars`}
        aria-invalid={edit.invalid || undefined}
        aria-describedby={edit.invalid ? errorId(bucket) : undefined}
        value={edit.text}
        onChange={(e) => edit.onText(e.target.value)}
        className="num pl-6 text-right"
      />
    </div>
  )
}

/** One bucket as a row: name and caption, status and progress, amount per pay. */
export function BucketRow({ bucket, edit = null, href, pacePercent, usual, LinkComponent = PlainLink }: Props) {
  const editing = edit !== null
  const amountEditable = editing && bucket.editable
  const hasMeter = !editing && usual !== 'hidden' && bucket.kind !== 'saver' && bucket.amountCents !== null && bucket.spentCents !== null
  const className =
    'grid grid-cols-[minmax(0,1fr)_112px] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_112px] sm:gap-x-6'
  const body = (
    <>
      <div className="order-1 min-w-0">
        <div className="flex items-center gap-2">
          <Dot token={bucket.colorToken} />
          <span className="truncate text-fg font-medium">{bucket.name}</span>
          {amountEditable && edit && (
            <Button variant="ghost" icon aria-label={`More about ${bucket.name}`} onClick={edit.onMore}>
              <span aria-hidden>⋯</span>
            </Button>
          )}
        </div>
        {(edit?.was != null || bucket.caption) && (
          <div className={cn('type-caption num truncate pl-4', bucket.saverMissing && edit?.was == null ? 'text-warning' : 'text-fg-3')}>
            {edit?.was != null ? `Was ${money(edit.was)}` : bucket.caption}
          </div>
        )}
      </div>
      <div className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1">
        {amountEditable && edit && <AmountSlider bucket={bucket} edit={edit} />}
        <div className="type-label num flex flex-wrap justify-between gap-x-3">
          {usual === 'shown' ? (
            <>
              <UsualStatus bucket={bucket} />
              <UsualSpare bucket={bucket} />
            </>
          ) : usual === 'hidden' ? null : (
            <>
              {!(editing && bucket.kind === 'saver') && <Status bucket={bucket} />}
              {bucket.kind !== 'shared-other' && bucket.kind !== 'saver' && bucket.spentCents !== null && (
                <span className="text-fg-3">{`${money(bucket.spentCents)} spent`}</span>
              )}
            </>
          )}
        </div>
        {hasMeter && <Meter bucket={bucket} pacePercent={pacePercent} usual={usual === 'shown'} />}
      </div>
      <div className="order-2 text-right sm:order-3">
        {amountEditable && edit ? (
          <AmountBox bucket={bucket} edit={edit} />
        ) : bucket.amountCents === null ? (
          <span className="text-fg-3" aria-label="No limit">
            –
          </span>
        ) : (
          <Money cents={bucket.amountCents} className="type-heading font-normal" />
        )}
      </div>
      {amountEditable && edit?.invalid && (
        <p id={errorId(bucket)} className="type-caption order-4 col-span-2 text-negative sm:col-span-3">
          Enter an amount like 25 or 25.50
        </p>
      )}
    </>
  )
  return (
    <li className="border-t border-line first:border-t-0">
      {href && !editing ? (
        <LinkComponent to={href} className={cn(className, 'transition-colors hover:bg-elevated')}>
          {body}
        </LinkComponent>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}
