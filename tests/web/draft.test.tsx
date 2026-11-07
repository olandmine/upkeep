import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { UserDto } from '../../src/shared/types'
import { DebtForm } from '../../src/web/components/debts/DebtForm'

const me = { id: 'u1', username: 'owner', displayName: 'Owner', negativeStyle: 'minus' } as UserDto

// A reload is the form mounting again in the same tab.
const reload = (onSave = vi.fn(), onCancel = vi.fn()) => {
  const view = render(<DebtForm me={me} onSave={onSave} onCancel={onCancel} />)
  return { ...view, onSave, onCancel }
}

test('a half-filled new debt comes back after a reload', async () => {
  const first = reload()
  await userEvent.type(screen.getByLabelText('Name'), 'Car')
  await userEvent.selectOptions(screen.getByLabelText('Kind'), 'credit_card')
  await userEvent.type(screen.getByLabelText('Balance'), '1200')
  first.unmount()

  reload()
  expect(screen.getByLabelText('Name')).toHaveValue('Car')
  expect(screen.getByLabelText('Kind')).toHaveValue('credit_card')
  expect(screen.getByLabelText('Balance')).toHaveValue('1200')
})

test('adding or cancelling forgets the draft', async () => {
  const first = reload()
  await userEvent.type(screen.getByLabelText('Name'), 'Car')
  await userEvent.type(screen.getByLabelText('Balance'), '1200')
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '5')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  expect(first.onSave).toHaveBeenCalled()
  first.unmount()
  const second = reload()
  expect(screen.getByLabelText('Name')).toHaveValue('')

  await userEvent.type(screen.getByLabelText('Name'), 'Boat')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(second.onCancel).toHaveBeenCalled()
  second.unmount()
  reload()
  expect(screen.getByLabelText('Name')).toHaveValue('')
})

test('a failed add keeps the draft', async () => {
  const first = reload(vi.fn().mockRejectedValue(new Error('nope')))
  await userEvent.type(screen.getByLabelText('Name'), 'Car')
  await userEvent.type(screen.getByLabelText('Balance'), '1200')
  await userEvent.type(screen.getByLabelText('Interest rate (yearly)'), '5')
  await userEvent.click(screen.getByRole('button', { name: 'Add debt' }))
  first.unmount()
  reload()
  expect(screen.getByLabelText('Name')).toHaveValue('Car')
})
