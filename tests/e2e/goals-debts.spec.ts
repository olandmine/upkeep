import { expect, test } from '@playwright/test'

const shot = (name: string) => `test-results/screens/${name}.png`
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Runs after foundation.spec.ts: the owner exists and Up is connected. The fake Up seed has four
// "ACME CAR FINANCE" repayments of $450 on the 1st of this month and the three before.
test('add a debt, mark a repayment, set a goal and see net worth', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: /Log in/ }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  // 1. A car loan starting on the 15th, four months back (before all four repayments).
  const start = new Date()
  start.setDate(1)
  start.setMonth(start.getMonth() - 4)
  start.setDate(15)
  await page.getByRole('link', { name: 'Debts' }).click()
  await expect(page.getByText('No debts yet. Add one to see when it’ll be paid off.')).toBeVisible()
  await page.getByRole('button', { name: 'Add debt' }).click()
  await page.getByLabel('Name').fill('Car loan')
  await page.getByLabel('Balance').fill('10000')
  await page.getByLabel('As of').fill(iso(start))
  await page.getByLabel('Interest rate (yearly)').fill('0')
  await page.getByLabel('Usual repayment').fill('450')
  await page.getByRole('button', { name: 'Add debt' }).last().click()
  await expect(page.getByRole('link', { name: /Car loan/ })).toContainText('Estimated')

  // 2. Mark one repayment from Transactions.
  await page.getByRole('link', { name: 'Transactions' }).click()
  const row = page.getByRole('row', { name: /ACME CAR FINANCE/ }).first()
  await row.getByRole('button', { name: /ACME CAR FINANCE/ }).click()
  const drawer = page.getByRole('dialog', { name: 'ACME CAR FINANCE' })
  await drawer.getByRole('button', { name: 'This is a repayment…' }).click()
  await drawer.getByRole('button', { name: 'Car loan' }).click()
  await expect(page.getByText('Marked as a repayment for Car loan').first()).toBeVisible()
  await expect(drawer.getByText('Not a repayment')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()

  // 3. All four repayments matched: $10,000 − 4 × $450.
  await page.getByRole('link', { name: 'Debts' }).click()
  const card = page.getByRole('link', { name: /Car loan/ })
  await expect(card).toContainText('$8,200.00')
  await expect(card).toContainText('Paid off by')
  await expect(card).not.toContainText('Estimated')
  await expect(page.getByRole('heading', { name: 'Avalanche' })).toBeVisible()
  await page.screenshot({ path: shot('debts'), fullPage: true })

  // 3b. A one-off with another description adds to the rule's repayments rather than replacing them.
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.getByRole('row', { name: /Woolworths/ }).first().getByRole('button', { name: /Woolworths/ }).click()
  const woolies = page.getByRole('dialog', { name: 'Woolworths' })
  await woolies.getByRole('button', { name: 'This is a repayment…' }).click()
  await woolies.getByRole('checkbox', { name: 'Also count future “Woolworths” payments' }).uncheck()
  await woolies.getByRole('button', { name: 'Car loan' }).click()
  await expect(woolies.getByText('Not a repayment')).toBeVisible()
  await woolies.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'Debts' }).click()
  await expect(card).toContainText('$8,156.79')
  await card.click()
  await expect(page.getByText('“acme car finance”')).toBeVisible()
  const oneOff = page.getByRole('row').filter({ hasText: 'One-off' })
  await expect(oneOff).toContainText('Woolworths')
  await oneOff.getByRole('button', { name: 'Not a repayment' }).click()
  await expect(page.getByText('One-off')).toBeHidden()
  await page.getByRole('link', { name: 'Debts' }).click()
  await expect(card).toContainText('$8,200.00')

  // 3c. Activity entries: add a fee dated today, see it and the new balance, then delete it again.
  await card.click()
  await expect(page.getByRole('heading', { name: 'Car loan' })).toBeVisible()
  await page.getByRole('button', { name: 'Add…' }).click()
  await page.getByRole('menuitem', { name: 'Added to debt' }).click()
  await page.getByLabel('Date').fill(iso(new Date()))
  await page.getByLabel('Amount').fill('500')
  await page.getByLabel('Note').fill('Fee')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const activity = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Balance' }) })
  const balance = page.locator('.type-kpi-xl')
  const fee = activity.getByRole('row').filter({ hasText: 'Fee' })
  await expect(fee).toContainText('+$500.00')
  await expect(balance).toHaveText('$8,700.00')
  await fee.getByRole('button', { name: /^Delete “?Fee/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(fee).toBeHidden()
  await expect(balance).toHaveText('$8,200.00')
  // The car loan has a 0% rate: no interest rows, just the opening rate. The Rate label is the
  // positive control that this label locator finds Activity rows (a row's text starts with its date).
  await expect(activity.getByText(/^Rate /)).toHaveCount(1)
  await expect(activity.getByText('Rate 0%')).toBeVisible()
  await expect(activity.getByText(/^Interest /)).toHaveCount(0)
  await page.getByRole('link', { name: 'Debts' }).click()

  // 4. A goal on the Food Saver.
  await page.getByRole('link', { name: 'Goals' }).click()
  await page
    .getByText('Food', { exact: true })
    .locator('..')
    .getByRole('button', { name: /^Set goal/ })
    .click()
  await page.getByLabel('Name').fill('Food buffer')
  await page.getByLabel('Target', { exact: true }).fill('400')
  await page.getByRole('button', { name: 'Save goal' }).click()
  await expect(page.getByText('$200.00 / $400.00')).toBeVisible()

  // 4a. A goal the Rainy Day Saver already covers celebrates once, then archives into Reached goals.
  await page.getByRole('button', { name: 'Set goal for Rainy Day' }).click()
  await page.getByLabel('Name').fill('Rainy fund')
  await page.getByLabel('Target', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Save goal' }).click()
  await expect(page.getByText('You reached Rainy fund!')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('You reached Rainy fund!')).toBeHidden()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Rainy fund', exact: true })).toBeVisible()
  await expect(page.getByText('You reached Rainy fund!')).toBeHidden()
  await page.getByRole('button', { name: 'Archive' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('link', { name: 'Rainy fund', exact: true })).toBeHidden()
  await expect(
    page.getByRole('region', { name: 'Savers without a goal' }).getByRole('link', { name: 'Rainy Day' }),
  ).toBeVisible()
  await page.getByText('Reached goals', { exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Rainy fund' })).toContainText('Rainy Day')

  // 4b. A Saver without a goal can follow the Car loan.
  const without = page.getByRole('region', { name: 'Savers without a goal' })
  await without.getByRole('button', { name: /^Set goal/ }).first().click()
  await page.getByRole('button', { name: /Pay off a debt/ }).click()
  const carLoan = await page.getByRole('option', { name: /^Car loan/ }).getAttribute('value')
  await page.getByLabel('Debt', { exact: true }).selectOption(carLoan!)
  await page.getByRole('button', { name: 'Save goal' }).click()
  await expect(page.getByRole('link', { name: 'Pays off Car loan' })).toBeVisible()
  await expect(page.getByText(/^Saved toward \d+ goals?$/)).toBeVisible()
  await page.screenshot({ path: shot('goals'), fullPage: true })

  // 4c. The goal's own page: its debt, its chart and its money, then back again.
  const followsCar = page.locator('section', { has: page.getByRole('link', { name: 'Pays off Car loan' }) })
  await followsCar.getByRole('link', { name: /^Details/ }).click()
  await expect(page.getByRole('heading', { name: 'Car loan', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The debt it follows' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show table' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Money in and out' })).toBeVisible()
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '1Y' }).click()
  await expect(page).toHaveURL(/[?&]range=1y/)
  await expect(page.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: shot('goal-page'), fullPage: true })
  await page.getByRole('link', { name: '‹ Goals' }).click()
  await expect(page.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible()

  // 5. Net worth.
  await page.getByRole('link', { name: 'Net worth' }).click()
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Net worth over time' })).toBeVisible()
  await page.screenshot({ path: shot('net-worth'), fullPage: true })

  // 6. Phones: the debt name stays readable.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/debts')
  const name = page.getByRole('link', { name: /Car loan/ }).getByText('Car loan', { exact: true })
  await expect(name).toBeVisible()
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: shot('debts-mobile'), fullPage: true })
})
