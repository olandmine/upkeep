import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { DayHeaderRow } from '../../src/web/components/transactions/TransactionTable'

test('day header is one cell spanning every column, with the net inside it', () => {
  // Account and Spent-by columns are hidden below lg/xl, so a fixed colSpan + extra cell misaligns.
  const { container } = render(
    <table>
      <tbody>
        <DayHeaderRow label="Thu 29 Oct" netCents={-750} />
      </tbody>
    </table>,
  )
  const cells = container.querySelectorAll('tr > *')
  expect(cells).toHaveLength(1)
  expect(cells[0]).toHaveAttribute('colspan', '7')
  expect(cells[0]).toHaveTextContent('Thu 29 Oct')
  expect(screen.getByLabelText('minus 7 dollars 50')).toBeInTheDocument()
})
