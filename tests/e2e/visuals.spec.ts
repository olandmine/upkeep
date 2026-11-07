import { expect, test, type Locator } from '@playwright/test'

const shot = (name: string) => `test-results/screens/${name}.png`
const transformOf = (box: Locator) => box.evaluate((el) => (el as HTMLElement).style.transform)

// Runs after budgets.spec.ts (the owner's pay is set) and goals-debts.spec.ts (Food has a goal).
test('see where the pay went, drag a box, and see the accounts summary', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: /Log in/ }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  // 1. The pay-flow card, starting from the pay.
  const card = page.getByRole('region', { name: 'Where the pay went' })
  await expect(page.getByRole('heading', { name: 'Where the pay went' })).toBeVisible()
  const pay = card.locator('.react-flow__node[data-id^="pay:"]')
  // Everyone scope names the pay by person; its "ACME PAY" description shows in the tooltip.
  await expect(pay).toContainText("Owner's pay")
  await expect(pay).toContainText('+$4,120.00')
  await page.screenshot({ path: shot('visuals-overview'), fullPage: true })
  await card.screenshot({ path: shot('visuals-payflow') })

  // 2. Drag the Spending box; the move is saved and survives a reload.
  const spending = card.locator('.react-flow__node[data-id^="account:"]').filter({ hasText: 'Spending' })
  await expect(spending).toBeVisible()
  const auto = await transformOf(spending)
  const at = (await spending.boundingBox())!
  const saved = page.waitForResponse(
    (r) => r.url().includes('/flow-layouts/') && r.request().method() === 'PUT',
  )
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await page.mouse.down()
  await page.mouse.move(at.x + at.width / 2 + 60, at.y + at.height / 2 + 60, { steps: 5 })
  await page.mouse.move(at.x + at.width / 2 + 120, at.y + at.height / 2 + 120, { steps: 5 })
  await page.mouse.up()
  expect((await saved).status()).toBe(204)
  await expect(page).toHaveURL(/\/$/)

  await page.reload()
  await expect(spending).toBeVisible()
  const dragged = await transformOf(spending)
  expect(dragged).not.toBe(auto)

  // 3. Reset layout puts it back.
  await card.getByRole('button', { name: 'Reset layout' }).click()
  await expect.poll(() => transformOf(spending)).toBe(auto)
  await expect(card.getByRole('button', { name: 'Reset layout' })).toBeHidden()

  // 3a. The − / + buttons and the + / − keys zoom the chart.
  const scaleOf = () =>
    card.locator('.react-flow__viewport').evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1]))
  const start = await scaleOf()
  await card.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(scaleOf).toBeCloseTo(start * 1.2, 2)
  await spending.locator('[tabindex="0"]').focus()
  await page.keyboard.press('-')
  await expect.poll(scaleOf).toBeLessThan(start * 1.2 - 0.01)
  await card.getByRole('button', { name: 'Fit' }).click()

  // 3c. Month shows the calendar month and steps by month; Pay cycle goes back.
  await card.getByRole('button', { name: 'Month' }).click()
  await expect(card.getByText(/^[A-Z][a-z]{2} \d{4}$/)).toBeVisible()
  await expect(card.getByRole('button', { name: 'Previous month' })).toBeEnabled()
  await expect(card.getByRole('button', { name: 'Next month' })).toBeDisabled()
  await card.getByRole('button', { name: 'Pay cycle' }).click()
  await expect(card.getByRole('button', { name: 'Previous cycle' })).toBeVisible()

  // 3b. A click pins the box's path instead of leaving the page; Esc lets go, and its link opens it.
  const opacityOf = (box: Locator) => box.locator('[tabindex="0"]').evaluate((el) => getComputedStyle(el).opacity)
  await spending.click()
  await expect(page).toHaveURL(/\/$/)
  const openLink = card.getByRole('button', { name: 'Open account ›' })
  await expect(openLink).toBeVisible()
  await expect.poll(() => opacityOf(pay)).toBe('1')
  await card.screenshot({ path: shot('visuals-payflow-focus') })
  await page.keyboard.press('Escape')
  await expect(openLink).toBeHidden()
  await spending.click()
  await openLink.click()
  await expect(page).toHaveURL(/\/accounts\//)
  await page.goto('/')

  // 4. Accounts: the summary, then each account's row with its goal.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Total balance' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Savers · Personal' })).toBeVisible()
  const food = page.getByRole('link', { name: /Food/ })
  await expect(food).toContainText('50% of $400')
  await expect(food.getByRole('meter')).toHaveAttribute('aria-valuenow', '50')
  await page.screenshot({ path: shot('visuals-accounts'), fullPage: true })

  // 5. Phones: everything still fits, with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(food).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true)
  await page.screenshot({ path: shot('visuals-accounts-mobile'), fullPage: true })

  // 5b. Phones: the Goals page, summary strip included, has no sideways scroll either.
  await page.goto('/goals')
  await expect(page.getByText(/^Saved toward \d+ goals?$/)).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true)
  await page.screenshot({ path: shot('visuals-goals-mobile'), fullPage: true })

  // 5c. Phones: a goal's own page, figures, chart and open month included, has none either.
  await page.getByRole('link', { name: 'Food buffer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Money in and out' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show table' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true)
  await page.screenshot({ path: shot('visuals-goal-mobile'), fullPage: true })

  // 6. Phones: the pay flow starts legible at the pay, not shrunk to fit every column.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await expect(pay).toBeVisible()
  const viewport = card.locator('.react-flow__viewport')
  await expect.poll(() => viewport.evaluate((el) => (el as HTMLElement).style.transform)).toMatch(/scale\(0\.6\)/)
  // The page scrolls to the chart; the chart itself must already show the whole pay box.
  await card.locator('.react-flow').scrollIntoViewIfNeeded()
  await expect(pay).toBeInViewport({ ratio: 1 })
  const pane = (await card.locator('.react-flow').boundingBox())!
  const payBox = (await pay.boundingBox())!
  expect(payBox.x).toBeGreaterThanOrEqual(pane.x)
  expect(payBox.x + payBox.width).toBeLessThanOrEqual(pane.x + pane.width)
  expect(payBox.y).toBeGreaterThanOrEqual(pane.y)
  expect(payBox.y + payBox.height).toBeLessThanOrEqual(pane.y + pane.height)
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true)
  await page.screenshot({ path: shot('visuals-overview-360'), fullPage: true })
})
