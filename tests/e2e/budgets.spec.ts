import { expect, test } from '@playwright/test'

const shot = (name: string) => `test-results/screens/${name}.png`

// Runs after foundation.spec.ts (Playwright project dependency): the owner exists and Up is connected.
test('mark pay, create buckets, and try changes to the plan', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: /Log in/ }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  await page.getByRole('link', { name: 'Budgets', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible()
  await page.getByRole('button', { name: /This is my pay: ACME PAY/ }).click()
  await expect(page.getByText(/^Found \d+ paydays since/)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByLabel('Amount for Food')).toBeVisible()
  await page.getByRole('button', { name: 'Add a spending bucket' }).click()
  await page.getByLabel('Name for new bucket').fill('Groceries')
  await page.getByLabel('Amount for Groceries').fill('600')
  await page.getByLabel('Category for Groceries').selectOption('groceries')
  await page.getByRole('button', { name: 'Create buckets' }).click()

  await expect(page.getByRole('heading', { name: 'Build your plan' })).toBeVisible()
  await expect(page.getByText('Rent', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save as my plan' }).click()

  // The pay page: Left to spend, Groceries at its limit, Rent's Saver transfer seen.
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary.getByText('Left to spend')).toBeVisible()
  const groceries = page.getByRole('link', { name: /Groceries/ })
  await expect(groceries).toContainText('$600.00')
  const rent = page.getByRole('link', { name: /Rent/ })
  await expect(rent).toContainText('Moved ✓')
  await page.screenshot({ path: shot('budgets'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: shot('budgets-mobile'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Edit mode: try a change, throw it away, then try it again and keep it for every pay.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const amount = page.getByLabel('Groceries amount in dollars')
  await amount.fill('650')
  await expect(page.getByText('Was $600.00')).toBeVisible()
  await page.screenshot({ path: shot('budgets-edit'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
  await page.screenshot({ path: shot('budgets-edit-mobile'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(groceries).toContainText('$600.00')

  // Start from pay split puts a Saver back to what Up moved into it, without saving anything.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const rentAmount = page.getByLabel('Rent amount in dollars')
  const moved = await rentAmount.inputValue()
  await rentAmount.fill('1')
  await page.getByRole('button', { name: 'Start from pay split' }).click()
  await expect(rentAmount).toHaveValue(moved)
  await page.getByRole('button', { name: 'Discard' }).click()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Groceries amount in dollars').fill('650')
  await page.getByRole('button', { name: 'Apply to every pay' }).click()
  await expect(page.getByRole('link', { name: /Groceries/ })).toContainText('$650.00')

  await page.reload()
  await expect(page.getByRole('link', { name: /Groceries/ })).toContainText('$650.00')
  await expect(page.getByRole('link', { name: /Rent/ })).toContainText('Moved ✓')

  // The This pay / Standard pay toggle and the page under it stay where they are as it switches, at both widths.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const toStandard = page.getByRole('button', { name: 'Standard pay' })
    const before = await toStandard.boundingBox()
    const summaryTop = (await summary.boundingBox())?.y
    await toStandard.click()
    await expect(summary.getByText(/^(Usually left over|Left after limits)$/)).toBeVisible()
    await expect(page.getByText(/^(Based on your last \d+ finished pays|Not enough finished pays yet)$/)).toBeVisible()
    expect(await toStandard.boundingBox(), `toggle at ${width}px`).toEqual(before)
    expect((await summary.boundingBox())?.y, `summary at ${width}px`).toBe(summaryTop)
    await page.getByRole('button', { name: 'This pay', exact: true }).click()
    await expect(summary.getByText('Left to spend')).toBeVisible()
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // Standard pay: what a normal pay usually leaves, edited for every pay only.
  await page.getByRole('button', { name: 'Standard pay' }).click()
  await expect(summary.getByText(/^(Usually left over|Left after limits)$/)).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'This pay only' })).toHaveCount(0)
  await page.getByLabel('Rent amount in dollars').fill('123')
  await page.getByRole('button', { name: 'Apply to every pay' }).click()
  await expect(page.getByRole('link', { name: /Rent/ })).toContainText('$123.00')
  await page.screenshot({ path: shot('budgets-standard'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
  await page.screenshot({ path: shot('budgets-standard-mobile'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'This pay', exact: true }).click()
  await expect(page.getByRole('link', { name: /Rent/ })).toContainText('$123.00')

  // Adding a limit suggests from recent spending; the fake data has nothing uncategorised in past pays, so the count is set here.
  await page.route('**/spending-history', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), uncategorised: { count: 3, cents: 12_345 } } })
  })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const spending = page.getByRole('region', { name: 'Stays in Spending' })
  await spending.getByRole('button', { name: 'Add bucket' }).click()
  await expect(spending.getByText(/3 transactions \(\$123\.45\) aren't categorised/)).toBeVisible()
  await spending.getByRole('group', { name: /^Top spending in your last/ }).getByRole('button').first().click()
  await expect(spending.getByLabel('Name')).not.toHaveValue('')
  await expect(spending.getByLabel('Limit')).not.toHaveValue('')
  await page.screenshot({ path: shot('budgets-suggestions'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
  await page.screenshot({ path: shot('budgets-suggestions-mobile'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await spending.getByRole('link', { name: 'Categorise' }).click()
  await expect(page).toHaveURL(/categoryId=uncategorised/)
  await expect(page.getByLabel('Category')).toHaveValue('uncategorised')
  await page.goBack()
  await page.getByRole('button', { name: 'Discard' }).click()
  await page.unroute('**/spending-history')

  // Goals: a dated goal on the Rent Saver shows what the plan puts in, and Try an amount reacts to the keyboard.
  await page.getByRole('link', { name: 'Goals' }).click()
  await page
    .getByText('Rent', { exact: true })
    .locator('..')
    .getByRole('button', { name: /^Set goal/ })
    .click()
  await page.getByLabel('Name').fill('Rent buffer')
  await page.getByLabel('Target', { exact: true }).fill('5000')
  const nextYear = new Date()
  nextYear.setFullYear(nextYear.getFullYear() + 1)
  await page.getByLabel('Target date (optional)').fill(nextYear.toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Save goal' }).click()
  const card = page.locator('section', { hasText: 'Rent buffer' }).last()
  await expect(card.getByText(/plan puts in/)).toBeVisible()
  await card.getByRole('button', { name: 'Try an amount' }).click()
  const slider = card.getByRole('slider', { name: 'Rent buffer: try an amount' })
  const result = card.locator('[aria-live="polite"]')
  const before = await result.textContent()
  await slider.focus()
  await slider.press('End')
  await expect(result).not.toHaveText(before ?? '')
  await card.getByRole('link', { name: 'Change in Budgets' }).click()
  await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible()
})

test('a transfer shows as one row that opens onto both sides', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: /Log in/ }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  await page.goto('/transactions?q=Transfer')
  const table = page.getByRole('table')
  const transfer = table.getByRole('button', { name: /Spending to Rent/ }).first()
  await expect(transfer).toHaveAttribute('aria-expanded', 'false')
  await transfer.click()
  await expect(transfer).toHaveAttribute('aria-expanded', 'true')
  const out = table.getByRole('row', { name: /Transfer to Rent/ }).first()
  await expect(out).toContainText('−$800.00')
  await expect(table.getByRole('row', { name: /Transfer from Spending/ }).first()).toContainText('+$800.00')
  await page.screenshot({ path: shot('transactions-transfer') })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
  await page.screenshot({ path: shot('transactions-transfer-mobile') })
  await page.setViewportSize({ width: 1440, height: 900 })

  await out.getByRole('button', { name: /Transfer to Rent/ }).click()
  await expect(page.getByRole('dialog', { name: 'Transfer to Rent' })).toBeVisible()
})
