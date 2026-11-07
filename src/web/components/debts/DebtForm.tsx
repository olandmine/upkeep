import { useState } from 'react'
import type {
  DebtDto,
  DebtInputDto,
  DebtKind,
  DebtPatchDto,
  DebtRateDto,
  FeeFrequency,
  HelpDebtInputDto,
  HelpImportSummaryDto,
  InterestSettingsDto,
  RepaymentFrequency,
  UserDto,
} from '../../../shared/types'
import { interestDefaults } from '../../../shared/debt-interest'
import { clearDrafts, useDraft } from '../../lib/draft'
import { parseDollars } from '../budgets/format'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { FEE_FREQUENCY_LABEL, FREQUENCY_LABEL, KIND_LABEL, parseRate, RATE_LABEL } from './format'
import { type ReadyStatement, StatementField } from './HelpImport'
import { InterestFields, interestValid } from './InterestFields'
import { RateHistory } from './RateHistory'

const select = 'type-body h-9 w-full rounded-sm border border-line-2 bg-elevated px-3 text-fg'

/** Today in the browser's timezone, as YYYY-MM-DD. */
export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface BalanceEdit {
  balanceCents: number
  asOf: string
  replacesId: string | null
}

/** A rate change saved through the rate history: from `fromDate` on. */
export interface RateChange {
  fromDate: string
  rateBp: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A new debt's fields are kept as a draft until it's added or cancelled; an edit isn't. */
const NEW_DEBT = 'new-debt:'

type Props =
  | {
      debt?: undefined
      me: UserDto
      onSave: (input: DebtInputDto) => Promise<void> | void
      /** Given both, a HECS debt can start from an ATO HELP statement instead of a balance. */
      onPreviewStatement?: (csv: string) => Promise<HelpImportSummaryDto>
      onSaveStatement?: (input: HelpDebtInputDto) => Promise<void>
      onCancel: () => void
    }
  | {
      debt: DebtDto
      /** The latest balance on record, shown for correcting; saved again only when changed. */
      balance?: { id: string; asOf: string; balanceCents: number }
      me: UserDto
      /** The rate history, newest first; each can be removed unless it's the only one. */
      rates?: DebtRateDto[]
      onRemoveRate?: (rateId: string) => void
      /**
       * `balance.replacesId`: the balance it moves to a new date, which goes once this one is saved.
       * `rate`: set when the rate differs from today's; it isn't part of the patch.
       */
      onSave: (patch: DebtPatchDto, balance: BalanceEdit | null, rate: RateChange | null) => Promise<void> | void
      onCancel: () => void
    }

/**
 * Add a debt (every field) or edit one (name, interest, rate, usual repayment and balance; kind and
 * owner are fixed). Editing corrects the latest balance: its amount, or its date (moving it, not
 * adding one). A new rate there is dated by "From" and saved through the rate history. A new HECS debt can
 * instead start from an ATO HELP statement, which sets its balance, interest and history.
 */
export function DebtForm(props: Props) {
  const { debt, me, onCancel } = props
  const latest = props.debt ? props.balance : undefined
  const initialBalance = latest ? (latest.balanceCents / 100).toFixed(2) : ''
  const initialAsOf = latest?.asOf ?? todayIso()
  const draft = (field: string) => (debt ? null : NEW_DEBT + field)
  const [name, setName] = useDraft(draft('name'), debt?.name ?? '')
  const [kind, setKind] = useDraft<DebtKind>(draft('kind'), debt?.kind ?? 'loan')
  const [owner, setOwner] = useDraft<'me' | 'joint'>(draft('owner'), 'me')
  const [balance, setBalance] = useDraft(draft('balance'), initialBalance)
  const [asOf, setAsOf] = useDraft(draft('asOf'), initialAsOf)
  const [rate, setRate] = useDraft(draft('rate'), debt ? String(debt.rateBp / 100) : '')
  const [fromDate, setFromDate] = useState(todayIso())
  const [interest, setInterest] = useDraft<InterestSettingsDto>(
    draft('interest'),
    debt?.interest ?? interestDefaults('loan', initialAsOf),
  )
  // Until it's edited, the interest settings follow the kind and first balance date.
  const [interestTouched, setInterestTouched] = useDraft(draft('interestTouched'), false)
  const [seenRateBp, setSeenRateBp] = useState(debt?.rateBp)
  const [repayment, setRepayment] = useDraft(draft('repayment'), debt ? (debt.repaymentCents / 100).toFixed(2) : '')
  const [frequency, setFrequency] = useDraft<RepaymentFrequency>(
    draft('frequency'),
    debt?.repaymentFrequency ?? 'monthly',
  )
  const [feeAmount, setFeeAmount] = useDraft(draft('feeAmount'), debt?.fee ? (debt.fee.amountCents / 100).toFixed(2) : '')
  const [feeFrequency, setFeeFrequency] = useDraft<FeeFrequency>(
    draft('feeFrequency'),
    debt?.fee?.frequency ?? 'monthly',
  )
  const [feeFrom, setFeeFrom] = useDraft(draft('feeFrom'), debt?.fee?.from ?? todayIso())
  const [saving, setSaving] = useState(false)
  // The statement itself isn't kept: after a reload it's picked again.
  const [start, setStart] = useDraft<'statement' | 'balance'>(draft('start'), 'statement')
  const [statement, setStatement] = useState<ReadyStatement | null>(null)
  const canUseStatement = !props.debt && kind === 'hecs' && !!props.onPreviewStatement && !!props.onSaveStatement
  const fromStatement = canUseStatement && start === 'statement'
  // A statement without indexation yet doesn't say the rate.
  const needsRate = !statement || statement.summary.indexationYears === 0

  const rateLabel = RATE_LABEL[kind]
  const rateBp = rateLabel ? parseRate(rate) : 0
  const balanceCents = parseDollars(balance)
  const repaymentCents = repayment.trim() === '' ? 0 : parseDollars(repayment)
  // An empty amount is no fee.
  const feeCents = feeAmount.trim() === '' ? 0 : parseDollars(feeAmount)
  const feeValid = feeCents === 0 || (feeCents !== null && DATE.test(feeFrom))
  const rateChanged = !!debt && rateLabel !== null && rateBp !== null && rateBp !== debt.rateBp
  const balanceChanged = balance !== initialBalance || asOf !== initialAsOf
  const statementValid =
    name.trim() !== '' && repaymentCents !== null && statement !== null && (!needsRate || rateBp !== null)
  const valid = fromStatement ? statementValid : feeValid && name.trim() !== '' &&
    rateBp !== null &&
    interestValid(interest) &&
    (!rateChanged || DATE.test(fromDate)) &&
    repaymentCents !== null &&
    asOf <= todayIso() &&
    // Adding needs a balance; editing needs one only if it was touched.
    (debt ? !balanceChanged || (balanceCents !== null && asOf !== '') : balanceCents !== null && asOf !== '')

  // Removing today's rate from the history moves it: an untouched field follows.
  if (debt && debt.rateBp !== seenRateBp) {
    setSeenRateBp(debt.rateBp)
    if (rate === String(seenRateBp! / 100)) setRate(String(debt.rateBp / 100))
  }

  function changeKind(next: DebtKind) {
    setKind(next)
    setInterest(interestDefaults(next, DATE.test(asOf) ? asOf : todayIso()))
    setInterestTouched(false)
    if (next === 'hecs' && repayment === '') setFrequency('monthly')
  }

  function changeAsOf(next: string) {
    setAsOf(next)
    if (!debt && !interestTouched && DATE.test(next)) setInterest(interestDefaults(kind, next))
  }

  async function submit() {
    if (!valid || repaymentCents === null) return
    setSaving(true)
    try {
      const fee = feeCents ? { amountCents: feeCents, frequency: feeFrequency, from: feeFrom } : null
      const common = { name: name.trim(), repaymentCents, repaymentFrequency: frequency, fee }
      if (fromStatement) {
        await props.onSaveStatement!({
          name: common.name,
          repaymentCents,
          repaymentFrequency: frequency,
          ownerUserId: owner === 'me' ? me.id : null,
          rateBp: needsRate ? rateBp! : 0,
          csv: statement!.csv,
        })
      } else if (rateBp === null) return
      else if (props.debt) {
        const moved = latest && asOf !== latest.asOf ? latest.id : null
        // The rate isn't patched: it changes through the rate history.
        await props.onSave(
          { ...common, interest },
          balanceChanged ? { balanceCents: balanceCents!, asOf, replacesId: moved } : null,
          rateChanged ? { fromDate, rateBp } : null,
        )
      }
      else
        await props.onSave({
          ...common,
          rateBp,
          interest,
          kind,
          ownerUserId: owner === 'me' ? me.id : null,
          balanceCents: balanceCents!,
          asOf,
        })
      if (!props.debt) clearDrafts(NEW_DEBT)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        // The page reports a failed save; the form stays filled in to try again.
        void submit().catch(() => {})
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {!debt && (
          <Field label="Kind">
            {(p) => (
              <select
                {...p}
                className={select}
                value={kind}
                onChange={(e) => changeKind(e.target.value as DebtKind)}
              >
                {(Object.keys(KIND_LABEL) as DebtKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {!debt && (
          <Field label="Owner">
            {(p) => (
              <select
                {...p}
                className={select}
                value={owner}
                onChange={(e) => setOwner(e.target.value as 'me' | 'joint')}
              >
                <option value="me">Me</option>
                <option value="joint">Joint</option>
              </select>
            )}
          </Field>
        )}
        {!fromStatement && (
          <Field label="Balance" error={balance !== '' && balanceCents === null ? 'Enter an amount' : null}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            )}
          </Field>
        )}
        {!fromStatement && (
          <Field label="As of" error={asOf > todayIso() ? "Balance date can't be in the future." : null}>
            {(p) => (
              <Input
                {...p}
                type="date"
                max={todayIso()}
                value={asOf}
                onChange={(e) => changeAsOf(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Usual repayment" error={repaymentCents === null ? 'Enter an amount' : null}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              placeholder="0.00"
              value={repayment}
              onChange={(e) => setRepayment(e.target.value)}
            />
          )}
        </Field>
        <Field label="How often">
          {(p) => (
            <select
              {...p}
              className={select}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RepaymentFrequency)}
            >
              {(Object.keys(FREQUENCY_LABEL) as RepaymentFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {canUseStatement && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="type-label mb-1.5 text-fg-2">Start from</legend>
          {(['statement', 'balance'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="debt-start" checked={start === k} onChange={() => setStart(k)} />
              {k === 'statement' ? 'ATO statement' : 'A balance'}
            </label>
          ))}
        </fieldset>
      )}
      {fromStatement && (
        <div className="flex flex-col gap-4">
          <StatementField onPreview={props.onPreviewStatement!} onReady={setStatement} />
          {statement && needsRate && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={RATE_LABEL.hecs!}
                hint="The statement has no indexation yet."
                error={rate !== '' && rateBp === null ? 'Rate must be between 0% and 100%.' : null}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}
        </div>
      )}
      {kind !== 'bnpl' && !fromStatement && (
        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="type-label mb-3 text-fg">Interest</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <InterestFields
              value={interest}
              onChange={(next) => {
                setInterest(next)
                setInterestTouched(true)
              }}
            />
            {rateLabel && (
              <Field
                label={rateLabel}
                error={rate !== '' && rateBp === null ? 'Rate must be between 0% and 100%.' : null}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                )}
              </Field>
            )}
            {rateChanged && (
              <Field label="From" hint="The new rate applies from this date.">
                {(p) => <Input {...p} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />}
              </Field>
            )}
          </div>
          {props.debt && <RateHistory rates={props.rates ?? []} today={todayIso()} onRemove={props.onRemoveRate} />}
        </fieldset>
      )}
      {!fromStatement && (
        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="type-label mb-3 text-fg">Account fee</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Account fee"
              hint="Leave empty if there's none."
              error={feeCents === null ? 'Enter an amount' : null}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                />
              )}
            </Field>
            {feeCents !== 0 && (
              <>
                <Field label="Fee how often">
                  {(p) => (
                    <select
                      {...p}
                      className={select}
                      value={feeFrequency}
                      onChange={(e) => setFeeFrequency(e.target.value as FeeFrequency)}
                    >
                      {(Object.keys(FEE_FREQUENCY_LABEL) as FeeFrequency[]).map((f) => (
                        <option key={f} value={f}>
                          {FEE_FREQUENCY_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Fee from" hint="A day it comes out; it repeats from here.">
                  {(p) => <Input {...p} type="date" value={feeFrom} onChange={(e) => setFeeFrom(e.target.value)} />}
                </Field>
              </>
            )}
          </div>
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (!debt) clearDrafts(NEW_DEBT)
            onCancel()
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || saving}>
          {debt ? 'Save debt' : 'Add debt'}
        </Button>
      </div>
    </form>
  )
}
