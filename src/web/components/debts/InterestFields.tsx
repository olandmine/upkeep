import type { InterestCalc, InterestCharge, InterestSettingsDto } from '../../../shared/types'
import { Field, Input } from '../ui/Input'

const select = 'type-body h-9 w-full rounded-sm border border-line-2 bg-elevated px-3 text-fg'

const CALC_LABEL: Record<InterestCalc, string> = { daily: 'Daily', on_charge: 'On the balance when charged' }
const CHARGE_LABEL: Record<InterestCharge, string> = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' }
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
/** February keeps the 29th: 02-29 is a real yearly date, clamped in other years. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const pad = (n: number) => String(n).padStart(2, '0')

/** Monthly needs a day from 1 to 31, yearly an `MM-DD` date. */
export function interestValid(i: InterestSettingsDto): boolean {
  if (i.charge === 'monthly') return Number.isInteger(i.chargeDay) && i.chargeDay! >= 1 && i.chargeDay! <= 31
  if (i.charge === 'yearly') return i.chargeDate !== null
  return true
}

/**
 * The interest settings as form fields: Calculated, Charged and its day or date. Renders bare fields,
 * so they flow into the caller's grid next to the rate.
 */
export function InterestFields({
  value,
  onChange,
}: {
  value: InterestSettingsDto
  onChange: (next: InterestSettingsDto) => void
}) {
  const [month, day] = (value.chargeDate ?? '06-01').split('-').map(Number) as [number, number]

  function changeCharge(charge: InterestCharge) {
    onChange({
      ...value,
      charge,
      chargeDay: charge === 'monthly' ? (value.chargeDay ?? 1) : null,
      chargeDate: charge === 'yearly' ? (value.chargeDate ?? '06-01') : null,
    })
  }

  return (
    <>
      <Field label="Calculated">
        {(p) => (
          <select
            {...p}
            className={select}
            value={value.calc}
            onChange={(e) => onChange({ ...value, calc: e.target.value as InterestCalc })}
          >
            {(Object.keys(CALC_LABEL) as InterestCalc[]).map((c) => (
              <option key={c} value={c}>
                {CALC_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Charged">
        {(p) => (
          <select
            {...p}
            className={select}
            value={value.charge}
            onChange={(e) => changeCharge(e.target.value as InterestCharge)}
          >
            {(Object.keys(CHARGE_LABEL) as InterestCharge[]).map((c) => (
              <option key={c} value={c}>
                {CHARGE_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {value.charge === 'monthly' && (
        <Field label="Day" error={interestValid(value) ? null : 'Pick a day from 1 to 31.'}>
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={value.chargeDay ?? ''}
              onChange={(e) => onChange({ ...value, chargeDay: e.target.value === '' ? null : Number(e.target.value) })}
            />
          )}
        </Field>
      )}
      {value.charge === 'yearly' && (
        <Field label="Date">
          {(p) => (
            <div className="flex gap-2">
              <select
                {...p}
                className={select}
                value={day}
                onChange={(e) => onChange({ ...value, chargeDate: `${pad(month)}-${pad(Number(e.target.value))}` })}
              >
                {Array.from({ length: DAYS_IN_MONTH[month - 1]! }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                aria-label="Month"
                className={select}
                value={month}
                onChange={(e) => {
                  const m = Number(e.target.value)
                  onChange({ ...value, chargeDate: `${pad(m)}-${pad(Math.min(day, DAYS_IN_MONTH[m - 1]!))}` })
                }}
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Field>
      )}
    </>
  )
}
