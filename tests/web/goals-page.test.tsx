import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ArchivedGoalDto, GoalDto } from '../../src/shared/types'
import { GoalsList } from '../../src/web/components/goals/GoalsList'
import { goal, sixGoals } from './goal-fixtures'

const list = async (goals: GoalDto[], extra: Partial<Parameters<typeof GoalsList>[0]> = {}) => {
  const root = createRootRoute({
    component: () => (
      <GoalsList
        goals={goals}
        archived={[]}
        today="2026-11-06"
        editingId={null}
        renderForm={(g) => <p>{`Form for ${g.saverName}`}</p>}
        onEdit={() => {}}
        onRemove={() => {}}
        onSeen={() => {}}
        onNewTarget={() => {}}
        onArchive={() => {}}
        onDeleteArchived={() => {}}
        {...extra}
      />
    ),
  })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
  const view = render(<RouterProvider router={router} />)
  await screen.findByText('Need attention')
  return view
}

test('summary figures', async () => {
  await list(sixGoals())
  expect(screen.getByText('Saved toward 4 goals')).toBeInTheDocument()
  expect(screen.getByText('1 behind · 1 buffer low')).toBeInTheDocument()
  expect(screen.getByText('Tax · 31 Mar')).toBeInTheDocument()
  expect(screen.getByText('On track')).toBeInTheDocument()
  expect(screen.getByText('1 goal')).toBeInTheDocument()
})

test('headings in order, with Rent as a compact row', async () => {
  await list(sixGoals())
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(headings).toEqual(['Needs attention', 'With a date', 'No date', 'Reached', 'Savers without a goal'])
  const section = screen.getByRole('region', { name: 'Savers without a goal' })
  expect(within(section).getByText('Rent Saver')).toBeInTheDocument()
  expect(within(section).getByText('$50.00')).toBeInTheDocument()
  expect(within(section).getByRole('button', { name: 'Set goal for Rent Saver' })).toBeInTheDocument()
})

test('empty sections are not rendered; all good', async () => {
  await list([goal({ status: 'on-track' })])
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['With a date'])
  expect(screen.getByText('All good')).toBeInTheDocument()
  expect(screen.getByText('Saved toward 1 goal')).toBeInTheDocument()
})

test('Set goal from the compact list reports the Saver; editing shows the form in place', async () => {
  const onEdit = vi.fn()
  await list(sixGoals(), { onEdit })
  await userEvent.click(screen.getByRole('button', { name: 'Set goal for Rent Saver' }))
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'rent' }))
})

test('the form replaces the compact row', async () => {
  await list(sixGoals(), { editingId: 'rent' })
  expect(screen.getByText('Form for Rent Saver')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Set goal/ })).not.toBeInTheDocument()
})

test('with only buffers there is no Saved toward figure', async () => {
  const buffer = { kind: 'buffer' as const, name: 'Food', targetCents: 40_000, targetDate: null }
  await list([goal({ goal: buffer, status: 'topped-up' })])
  expect(screen.queryByText(/Saved toward/)).not.toBeInTheDocument()
})

test('a Saver without a goal links to its page', async () => {
  await list(sixGoals())
  expect(screen.getByRole('link', { name: 'Rent Saver' })).toHaveAttribute('href', '/goals/rent')
})

const archivedRow = (over: Partial<ArchivedGoalDto> = {}): ArchivedGoalDto => ({
  id: 'a1',
  accountId: 's1',
  saverName: 'Holiday Saver',
  name: 'Holiday',
  kind: 'save',
  targetCents: 200_000,
  debtName: null,
  debtPaidOff: false,
  reachedOn: '2026-08-14',
  canEdit: true,
  ...over,
})

const details = () => screen.getByText('Reached goals').closest('details')!

test('Reached goals is closed by default, with a row per goal', async () => {
  await list(sixGoals(), { archived: [archivedRow()] })
  expect(details()).not.toHaveAttribute('open')
  const row = within(details()).getByRole('listitem')
  expect(row).toHaveTextContent('Holiday')
  expect(row).toHaveTextContent('Holiday Saver')
  expect(row).toHaveTextContent('$2,000.00')
  expect(row).toHaveTextContent('Reached Aug 2026')
})

test('a debt goal row says whether the debt was paid off or covered', async () => {
  await list(sixGoals(), {
    archived: [
      archivedRow({ id: 'a1', kind: 'debt', debtName: 'Car loan', debtPaidOff: true }),
      archivedRow({ id: 'a2', kind: 'debt', debtName: 'Car loan', debtPaidOff: false }),
    ],
  })
  expect(within(details()).getByText('Paid off Car loan')).toBeInTheDocument()
  expect(within(details()).getByText('Covered Car loan')).toBeInTheDocument()
})

test('an archived row leaves out a $0.00 target', async () => {
  await list(sixGoals(), {
    archived: [archivedRow({ kind: 'debt', targetCents: 0, debtName: 'Car loan', debtPaidOff: true })],
  })
  const row = within(details()).getByRole('listitem')
  expect(row).not.toHaveTextContent('$0.00')
  expect(row).toHaveTextContent('Paid off Car loan')
})

test('no Reached goals section without rows', async () => {
  await list(sixGoals())
  expect(screen.queryByText('Reached goals')).not.toBeInTheDocument()
})

test('Delete needs the confirm, and only shows with edit rights', async () => {
  const onDeleteArchived = vi.fn()
  const { unmount } = await list(sixGoals(), { archived: [archivedRow()], onDeleteArchived })
  await userEvent.click(screen.getByText('Reached goals'))
  await userEvent.click(screen.getByRole('button', { name: 'Delete Holiday' }))
  expect(onDeleteArchived).not.toHaveBeenCalled()
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('Delete Holiday from Reached goals?')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  expect(onDeleteArchived).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  unmount()
  await list(sixGoals(), { archived: [archivedRow({ canEdit: false })] })
  expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
})
