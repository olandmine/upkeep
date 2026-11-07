import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { GoalDebtOptionDto, GoalDto } from '../../src/shared/types'
import { GoalCard } from '../../src/web/components/goals/GoalCard'
import { GoalForm } from '../../src/web/components/goals/GoalForm'
import { GoalPlan } from '../../src/web/components/goals/GoalPlan'
import { readFileSync } from 'node:fs'

const goal = (over: Partial<GoalDto> = {}): GoalDto => ({
  accountId: 's1',
  saverName: 'Holiday Saver',
  balanceCents: 62_000,
  ownerUserId: 'u1',
  goal: { kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2026-12-31' },
  progress: 0.62,
  status: 'on-track',
  neededCents: 9_500,
  neededPer: 'pay',
  behindCents: null,
  projectedDate: null,
  toGoCents: null,
  expectedProgress: null,
  belowCents: null,
  recentRateCents: null,
  debtFallCents: null,
  followedDebtName: null,
  reachedOn: null,
  celebrate: false,
  ownerName: null,
  debt: null,
  plan: null,
  cadence: null,
  saverOutCents: null,
  sparkline: null,
  today: '2026-10-30',
  canEdit: true,
  accountMissing: false,
  ...over,
})

const noop = { onEdit: () => {}, onRemove: () => {}, onSeen: () => {}, onNewTarget: () => {}, onArchive: () => {} }

const card = async (over: Partial<GoalDto> = {}, handlers: Partial<typeof noop> = {}) => {
  const root = createRootRoute({
    component: () => <GoalCard goal={goal(over)} {...noop} {...handlers} />,
  })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
  const view = render(<RouterProvider router={router} />)
  await screen.findByText(over.accountMissing ? 'Saver not found' : (over.goal?.name ?? 'Holiday'))
  return view
}

test('progress and on track', async () => {
  await card()
  expect(screen.getByText('Holiday')).toBeInTheDocument()
  expect(screen.getByText('$620.00 / $1,000.00')).toBeInTheDocument()
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '62')
  expect(screen.getByText('$95.00 a pay to reach it by 31 Dec · on track')).toBeInTheDocument()
})

test('a default goal says so', async () => {
  await card({ goal: { kind: 'save', name: 'Save Up Challenge', targetCents: 100_000, targetDate: null, isDefault: true } })
  expect(screen.getByText('Default goal')).toBeInTheDocument()
})

test('statuses', async () => {
  const cases: [Partial<GoalDto>, string][] = [
    [{ status: 'behind', neededCents: 5_000, recentRateCents: 2_000 }, '$50.00 a pay to reach it by 31 Dec · lately about $20.00'],
    [{ status: 'date-passed', toGoCents: 38_000 }, 'The date passed with $380.00 to go.'],
    [{ status: 'projected', projectedDate: '2027-03-12' }, 'At this rate, about Mar 2027'],
    [{ status: 'not-growing', toGoCents: 38_000 }, 'Not growing lately. $380.00 to go.'],
    [{ status: 'reached', progress: 1 }, 'Reached ✓'],
    [{ status: 'reached', progress: 1, reachedOn: '2026-10-30' }, 'Reached 30 Oct'],
    [{ status: 'topped-up', progress: 1 }, 'Topped up'],
  ]
  for (const [over, text] of cases) {
    const { unmount } = await card(over)
    expect(screen.getByText(text)).toBeInTheDocument()
    unmount()
  }
})

test('to go sits under the bar for an unreached save goal only', async () => {
  const { unmount } = await card({ toGoCents: 380_000 })
  expect(screen.getByText('$3,800.00 to go')).toBeInTheDocument()
  unmount()
  const buffer = { kind: 'buffer' as const, name: 'Holiday', targetCents: 100_000, targetDate: null }
  const b = await card({ goal: buffer, status: 'below', belowCents: 100, toGoCents: null })
  expect(screen.queryByText(/to go$/)).not.toBeInTheDocument()
  expect(screen.getByText('Keep topped up')).toBeInTheDocument()
  b.unmount()
  await card({ status: 'reached', progress: 1, toGoCents: null })
  expect(screen.queryByText(/to go$/)).not.toBeInTheDocument()
})

test('the expected-by-now tick', async () => {
  const { unmount } = await card({ expectedProgress: 0.57 })
  const tick = screen.getByRole('img', { name: 'Expected by now: 57%' })
  expect(tick).toHaveStyle({ left: '57%' })
  // Children of a meter are presentational, so the tick must sit beside it to keep its label.
  expect(screen.getByRole('meter')).not.toContainElement(tick)
  unmount()
  await card({ expectedProgress: null })
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

const carLoan = { id: 'd1', name: 'Car loan', leftCents: 900_000, startTargetCents: 1_306_000, paidOff: false }
const debtGoal = { kind: 'debt' as const, name: 'Car', targetCents: 1_306_000, targetDate: null }

test('a debt goal links to its debt and explains the target', async () => {
  const { unmount } = await card({ goal: debtGoal, debt: carLoan, status: 'projected', projectedDate: '2027-03-12' })
  expect(screen.getByRole('link', { name: 'Pays off Car loan' })).toHaveAttribute('href', '/debts/d1')
  expect(screen.getByRole('link', { name: 'Pays off Car loan' })).toHaveClass('underline')
  expect(screen.getByText('The target follows the debt: it was $13,060.00 when you set this.')).toBeInTheDocument()
  unmount()
  await card({ goal: debtGoal, debt: { ...carLoan, paidOff: true }, status: 'reached', progress: 1 })
  expect(screen.getByText('Car loan is paid off.')).toBeInTheDocument()
})

test('a goal whose debt was deleted keeps its last target', async () => {
  await card({
    goal: { kind: 'save', name: 'Car', targetCents: 1_120_000, targetDate: null },
    followedDebtName: 'Car loan',
  })
  expect(screen.getByText('Car loan was deleted, so this goal keeps its last target of $11,200.00.')).toBeInTheDocument()
})

test('set goal only when editable', async () => {
  const onEdit = vi.fn()
  const { rerender } = render(
    <GoalCard goal={goal({ goal: null, status: null })} {...noop} onEdit={onEdit} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Set goal for Holiday Saver' }))
  expect(onEdit).toHaveBeenCalled()
  rerender(
    <GoalCard
      goal={goal({ goal: null, status: null, canEdit: false })}
      {...noop}
      onEdit={onEdit}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Set goal for Holiday Saver' })).not.toBeInTheDocument()
})

test('saver not found', async () => {
  const onRemove = vi.fn()
  render(
    <GoalCard
      goal={goal({ accountMissing: true, saverName: null, status: null })}
      {...noop}
      onRemove={onRemove}
    />,
  )
  expect(screen.getByText('Saver not found')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete goal' }))
  expect(onRemove).toHaveBeenCalled()
})

test('goal form defaults the name to the saver', async () => {
  const onSave = vi.fn()
  render(<GoalForm saverName="Holiday Saver" debts={undefined} onSave={onSave} onCancel={() => {}} />)
  expect(screen.getByLabelText('Name')).toHaveValue('Holiday Saver')
  await userEvent.type(screen.getByLabelText('Target'), '1000')
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'save', name: 'Holiday Saver', targetCents: 100_000, targetDate: null })
})

test('goal form keeps an existing past date', async () => {
  const onSave = vi.fn()
  render(
    <GoalForm
      goal={{ kind: 'save', name: 'Holiday', targetCents: 100_000, targetDate: '2020-01-01' }}
      saverName="Holiday Saver"
      debts={undefined}
      onSave={onSave}
      onCancel={() => {}}
    />,
  )
  await userEvent.clear(screen.getByLabelText('Name'))
  await userEvent.type(screen.getByLabelText('Name'), 'Japan')
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'save', name: 'Japan', targetCents: 100_000, targetDate: '2020-01-01' })
})

const debts: GoalDebtOptionDto[] = [
  { id: 'd1', name: 'Car loan', leftCents: 1_120_000, followedBy: null },
  { id: 'd2', name: 'ATO debt', leftCents: 495_000, followedBy: 'Tax' },
]

test('goal form has kind buttons, starting on the goal kind', async () => {
  const { unmount } = render(
    <GoalForm saverName="Holiday Saver" debts={undefined} onSave={() => {}} onCancel={() => {}} />,
  )
  expect(screen.getByRole('group', { name: 'What is this Saver for?' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Save up to/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /Keep topped up/ })).toHaveAttribute('aria-pressed', 'false')
  unmount()
  render(
    <GoalForm
      goal={{ kind: 'buffer', name: 'Cushion', targetCents: 40_000, targetDate: null }}
      saverName="Holiday Saver"
      debts={undefined}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: /Keep topped up/ })).toHaveAttribute('aria-pressed', 'true')
})

test('goal form saves a buffer with no date', async () => {
  const onSave = vi.fn()
  render(<GoalForm saverName="Holiday Saver" debts={undefined} onSave={onSave} onCancel={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /Keep topped up/ }))
  expect(screen.getByLabelText('Level to keep')).toBeInTheDocument()
  expect(screen.queryByLabelText('Target date (optional)')).not.toBeInTheDocument()
  expect(screen.getByText(/Shows "Topped up" at or above this level/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Level to keep'), '400')
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'buffer', name: 'Holiday Saver', targetCents: 40_000, targetDate: null })
})

test('a past date typed under Save up to is ignored once the kind is Keep topped up', async () => {
  const onSave = vi.fn()
  render(<GoalForm saverName="Holiday Saver" debts={undefined} onSave={onSave} onCancel={() => {}} />)
  await userEvent.type(screen.getByLabelText('Target date (optional)'), '2020-01-01')
  await userEvent.click(screen.getByRole('button', { name: /Keep topped up/ }))
  await userEvent.type(screen.getByLabelText('Level to keep'), '400')
  expect(screen.getByRole('button', { name: 'Save goal' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'buffer', name: 'Holiday Saver', targetCents: 40_000, targetDate: null })
})

test('switching an edited debt goal to Save up to prefills its current target', async () => {
  render(
    <GoalForm
      goal={{ kind: 'debt', name: 'Car', targetCents: 1_120_000, targetDate: null }}
      followedDebtId="d1"
      saverName="Holiday Saver"
      debts={debts}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /Save up to/ }))
  expect(screen.getByLabelText('Target')).toHaveValue('11200.00')
  await userEvent.click(screen.getByRole('button', { name: /Keep topped up/ }))
  expect(screen.getByLabelText('Level to keep')).toHaveValue('11200.00')
})

test('goal form follows a debt', async () => {
  const onSave = vi.fn()
  const onKindChange = vi.fn()
  render(
    <GoalForm saverName="Holiday Saver" debts={debts} onKindChange={onKindChange} onSave={onSave} onCancel={() => {}} />,
  )
  await userEvent.click(screen.getByRole('button', { name: /Pay off a debt/ }))
  expect(onKindChange).toHaveBeenLastCalledWith('debt')
  expect(screen.getByRole('option', { name: 'Car loan · $11,200.00 left' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'ATO debt · $4,950.00 left (followed by Tax)' })).toBeDisabled()
  await userEvent.selectOptions(screen.getByLabelText('Debt'), 'd1')
  expect(screen.getByText(/The target follows the debt: \$11,200\.00 today/)).toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toHaveValue('Car loan')
  await userEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(onSave).toHaveBeenCalledWith({ kind: 'debt', name: 'Car loan', debtId: 'd1', targetDate: null })
})

test('goal form with no debts cannot save a debt goal', async () => {
  render(<GoalForm saverName="Holiday Saver" debts={[]} onSave={() => {}} onCancel={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /Pay off a debt/ }))
  expect(screen.getByText(/No debts this Saver can follow/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save goal' })).toBeDisabled()
})

const cadence = { kind: 'pay' as const, frequencyDays: 14, lastPayDate: '2026-10-22' }
const mine = { amountCents: 20_000, mineCents: 20_000, partnerCents: null, partnerName: null, partial: false }
const planned = (over: Partial<GoalDto> = {}): Partial<GoalDto> => ({
  plan: mine,
  cadence,
  goal: { kind: 'save', name: 'Holiday', targetCents: 187_000, targetDate: '2026-12-31' },
  neededCents: 25_000,
  ...over,
})

test('the card shows the plan line and a warning comparison', async () => {
  await card(planned())
  expect(screen.getByText('Your plan puts in $200.00 a pay', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('short by $50.00 a pay')).toHaveClass('text-warning')
})

test('says when only your plan is included', async () => {
  const { unmount } = await card(planned({ plan: { ...mine, partial: true } }))
  expect(screen.getByText('Includes only your plan')).toBeInTheDocument()
  unmount()
  await card(planned())
  expect(screen.queryByText('Includes only your plan')).not.toBeInTheDocument()
})

test('links to Budgets from the plan block', async () => {
  const { unmount } = await card(planned())
  expect(screen.getByRole('link', { name: 'Change in Budgets' })).toHaveAttribute('href', '/budgets?view=standard')
  expect(screen.queryByRole('link', { name: 'Add it to your plan' })).not.toBeInTheDocument()
  unmount()
  const none = await card(planned({ plan: null }))
  expect(screen.getByRole('link', { name: 'Add it to your plan' })).toHaveAttribute('href', '/budgets?view=standard')
  none.unmount()
  const theirs = await card(planned({ plan: { ...mine, mineCents: 0, partnerCents: 20_000, partnerName: 'Sam' } }))
  expect(screen.getByRole('link', { name: 'Add it to your plan' })).toBeInTheDocument()
  theirs.unmount()
  await card(planned({ canEdit: false }))
  expect(screen.queryByRole('link', { name: /Change in Budgets|Add it to your plan/ })).not.toBeInTheDocument()
})

test('Try an amount opens a slider and never fetches', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  await card(planned())
  const toggle = screen.getByRole('button', { name: 'Try an amount' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const slider = screen.getByRole('slider', { name: 'Holiday: try an amount' })
  expect(slider).toHaveValue('20000')
  expect(slider).toHaveAttribute('step', '1000')
  expect(slider).toHaveAttribute('aria-valuetext', '$200.00 a pay')
  expect(screen.getByText('Short by $50.00 a pay')).toBeInTheDocument()
  fireEvent.change(slider, { target: { value: '25000' } })
  expect(screen.getByText('Enough to reach it by 31 Dec')).toBeInTheDocument()
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})

test('the slider opens on the exact plan, and its first move lands on a step', async () => {
  await card(planned({ plan: { ...mine, amountCents: 24_500, mineCents: 24_500 },
    neededCents: 24_800,
    goal: { kind: 'save', name: 'Holiday', targetCents: 186_000, targetDate: '2026-12-31' },
  }))
  await userEvent.click(screen.getByRole('button', { name: 'Try an amount' }))
  const slider = screen.getByRole('slider', { name: 'Holiday: try an amount' })
  expect(screen.getByText('$245.00 a pay')).toBeInTheDocument()
  expect(slider).toHaveAttribute('aria-valuetext', '$245.00 a pay')
  expect(screen.getByText('Short by $3.00 a pay')).toBeInTheDocument()
  fireEvent.change(slider, { target: { value: '26000' } })
  expect(screen.getByText('$260.00 a pay')).toBeInTheDocument()
})

test('the slider never exceeds a lowered max after a refetch', async () => {
  const big = goal(planned({ plan: { ...mine, amountCents: 90_000, mineCents: 90_000 }, neededCents: 50_000 }))
  const small = goal(planned({ plan: { ...mine, amountCents: 20_000, mineCents: 20_000 }, neededCents: 25_000 }))
  let swap: (g: GoalDto) => void = () => {}
  const Root = () => {
    const [g, setG] = useState(big)
    swap = setG
    return <GoalPlan goal={g} alwaysOpen />
  }
  const root = createRootRoute({ component: Root })
  render(<RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })} />)
  expect(await screen.findByText('$900.00 a pay')).toBeInTheDocument()
  act(() => swap(small))
  const slider = screen.getByRole('slider', { name: 'Holiday: try an amount' })
  expect(slider).toHaveAttribute('max', '50000')
  expect(slider).toHaveValue('50000')
  expect(slider).toHaveAttribute('aria-valuetext', '$500.00 a pay')
  expect(screen.getByText('$500.00 a pay')).toBeInTheDocument()
})

test('Try an amount is left out where it does not apply', async () => {
  const buffer = { kind: 'buffer' as const, name: 'Holiday', targetCents: 100_000, targetDate: null }
  const b = await card(planned({ goal: buffer, status: 'below', belowCents: 100 }))
  expect(screen.getByText('Your plan puts in $200.00 a pay')).toBeInTheDocument()
  expect(screen.queryByText(/short by|enough to/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try an amount' })).not.toBeInTheDocument()
  b.unmount()
  const r = await card(planned({ status: 'reached', progress: 1 }))
  expect(screen.queryByRole('button', { name: 'Try an amount' })).not.toBeInTheDocument()
  r.unmount()
  await card(planned({ canEdit: false }))
  expect(screen.queryByRole('button', { name: 'Try an amount' })).not.toBeInTheDocument()
})

test('alwaysOpen has no toggle', async () => {
  const root = createRootRoute({ component: () => <GoalPlan goal={goal(planned())} alwaysOpen /> })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('slider', { name: 'Holiday: try an amount' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try an amount' })).not.toBeInTheDocument()
})

test('a sparkline, labelled, when there is one', async () => {
  const { unmount } = await card({ sparkline: { balance: [0, 10, 20], target: null } })
  expect(screen.getByRole('img', { name: 'Holiday balance over the last 6 months' })).toBeInTheDocument()
  unmount()
  await card({ sparkline: null })
  expect(screen.queryByRole('img', { name: /balance over the last 6 months/ })).not.toBeInTheDocument()
})

test('the name and Details link to the goal page; a missing Saver has neither', async () => {
  const { unmount } = await card()
  expect(screen.getByRole('link', { name: 'Holiday' })).toHaveAttribute('href', '/goals/s1')
  expect(screen.getByRole('link', { name: 'Details for Holiday' })).toHaveAttribute('href', '/goals/s1')
  expect(screen.getByRole('link', { name: 'Details for Holiday' })).toHaveTextContent(/^Details$/)
  unmount()
  const viewer = await card({ canEdit: false })
  expect(screen.getByRole('link', { name: 'Details for Holiday' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  viewer.unmount()
  await card({ accountMissing: true })
  expect(screen.queryByRole('link', { name: /^Details/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Holiday' })).not.toBeInTheDocument()
})

const reached = (over: Partial<GoalDto> = {}): Partial<GoalDto> => ({
  status: 'reached',
  progress: 1,
  balanceCents: 120_000,
  toGoCents: null,
  reachedOn: '2026-10-30',
  ...over,
})

test('the banner names the goal, or the debt, or the other person', async () => {
  const cases: [Partial<GoalDto>, string][] = [
    [reached({ celebrate: true }), 'You reached Holiday!'],
    [
      reached({ celebrate: true, goal: debtGoal, debt: { ...carLoan, paidOff: true } }),
      'Car loan is paid off!',
    ],
    [
      reached({ celebrate: true, ownerName: 'Sam', goal: debtGoal, debt: { ...carLoan, paidOff: true } }),
      'Car loan is paid off!',
    ],
    [reached({ celebrate: true, goal: debtGoal, debt: carLoan }), 'You can pay off Car loan now!'],
    [reached({ celebrate: true, ownerName: 'Sam' }), 'Sam reached Holiday!'],
    [
      reached({ celebrate: true, ownerName: 'Sam', goal: debtGoal, debt: carLoan }),
      'Sam can pay off Car loan now!',
    ],
  ]
  for (const [over, text] of cases) {
    const { unmount } = await card(over)
    expect(screen.getByRole('status')).toHaveTextContent(text)
    unmount()
  }
})

test('no banner unless celebrate', async () => {
  await card(reached())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
})

test('Dismiss hides the banner at once and reports it seen', async () => {
  const onSeen = vi.fn()
  await card(reached({ celebrate: true }), { onSeen })
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onSeen).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('the bar fill animates only while celebrating', async () => {
  const { unmount } = await card(reached({ celebrate: true }))
  expect(screen.getByRole('meter').firstElementChild).toHaveClass('goal-fill')
  unmount()
  await card(reached())
  expect(screen.getByRole('meter').firstElementChild).not.toHaveClass('goal-fill')
})

test('the goal-fill animation only exists when motion is allowed', () => {
  const css = readFileSync('src/web/styles/tokens.css', 'utf8')
  const open = css.indexOf('@media (prefers-reduced-motion: no-preference)')
  expect(open).toBeGreaterThan(-1)
  // The block ends where its braces balance.
  let depth = 0
  let end = open
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const block = css.slice(open, end)
  expect(block).toContain('@keyframes goal-fill')
  expect(block).toContain('.goal-fill')
  expect(block).toContain('600ms')
  expect(css.replace(block, '')).not.toContain('goal-fill')
})

test('a reached goal can set a new target, which must beat the balance', async () => {
  const onNewTarget = vi.fn()
  await card(reached(), { onNewTarget })
  await userEvent.click(screen.getByRole('button', { name: 'Set a new target' }))
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()
  await userEvent.type(screen.getByLabelText('New target'), '1200')
  expect(save).toBeDisabled()
  await userEvent.clear(screen.getByLabelText('New target'))
  await userEvent.type(screen.getByLabelText('New target'), '1500')
  expect(save).toBeEnabled()
  await userEvent.click(save)
  expect(onNewTarget).toHaveBeenCalledWith(150_000)
})

test('saving a new target waits for the save, then closes and clears the form', async () => {
  let finish = () => {}
  const onNewTarget = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  await card(reached(), { onNewTarget })
  await userEvent.click(screen.getByRole('button', { name: 'Set a new target' }))
  await userEvent.type(screen.getByLabelText('New target'), '1500')
  const save = screen.getByRole('button', { name: 'Save' })
  await userEvent.click(save)
  // A second submit while the first is in flight would be refused by the server.
  expect(save).toBeDisabled()
  fireEvent.submit(screen.getByLabelText('New target').closest('form')!)
  expect(onNewTarget).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(screen.queryByLabelText('New target')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Set a new target' }))
  expect(screen.getByLabelText('New target')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('a new target that fails keeps the form and its amount', async () => {
  const onNewTarget = vi.fn(() => Promise.reject(new Error('Boom')))
  await card(reached(), { onNewTarget })
  await userEvent.click(screen.getByRole('button', { name: 'Set a new target' }))
  await userEvent.type(screen.getByLabelText('New target'), '1500')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled()
  expect(screen.getByLabelText('New target')).toHaveValue('1500')
})

test('Cancel closes the new target form', async () => {
  await card(reached())
  await userEvent.click(screen.getByRole('button', { name: 'Set a new target' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByLabelText('New target')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Set a new target' })).toBeInTheDocument()
})

test('Archive asks first, then archives', async () => {
  const onArchive = vi.fn()
  await card(reached(), { onArchive })
  await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
  expect(onArchive).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    "Archive Holiday? It moves to Reached goals and frees Holiday Saver for a new goal. You can't undo this.",
  )
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))
  expect(onArchive).toHaveBeenCalledTimes(1)
})

test('the reached actions are for people who can edit a goal that is reached', async () => {
  const cases: Partial<GoalDto>[] = [
    reached({ canEdit: false }),
    { status: 'on-track' },
    reached({ status: 'topped-up', goal: { kind: 'buffer', name: 'Food', targetCents: 100_000, targetDate: null } }),
  ]
  for (const over of cases) {
    const { unmount } = await card(over)
    expect(screen.queryByRole('button', { name: 'Set a new target' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    unmount()
  }
})

test('a debt goal can be archived but not given a new target', async () => {
  await card(reached({ goal: debtGoal, debt: { ...carLoan, paidOff: true } }))
  expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Set a new target' })).not.toBeInTheDocument()
})

test('the built-in goal can be given a new target but not archived', async () => {
  await card(
    reached({
      reachedOn: null,
      goal: { kind: 'save', name: 'Save Up Challenge', targetCents: 100_000, targetDate: null, isDefault: true },
    }),
  )
  expect(screen.getByRole('button', { name: 'Set a new target' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
})
