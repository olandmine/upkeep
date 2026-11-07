import { expect, test, type Page } from '@playwright/test'

const shot = (name: string) => `test-results/screens/${name}.png`
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('set up, connect Up, recategorise and see the overview', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await page.screenshot({ path: shot('setup') })

  await page.getByLabel('Your name').fill('Owner')
  await page.getByLabel('Your Up $handle').fill('$owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/sharing$/)
  await page.getByRole('radio', { name: /Full transparency/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/connect$/)
  await page.screenshot({ path: shot('connect-up') })
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await noSideways(page), `/connect at ${width}px`).toBe(true)
  }
  await page.screenshot({ path: shot('connect-up-mobile'), fullPage: true })
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('0 of 3 done')).toBeVisible()
  await page.screenshot({ path: shot('getting-started-mobile'), fullPage: true })

  // A row's link lands on its card, in view on a phone.
  await page.getByRole('link', { name: /Add your partner/ }).click()
  await expect(page.getByRole('region', { name: 'People' })).toBeInViewport()
  await page.goBack()
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('link', { name: /Connect Up/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByLabel('Up personal access token').fill('up:yeah:e2e')
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText(/Last synced/)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Overview' }).click()
  await expect(page.getByText(/^1 of \d done$/)).toBeVisible()
  await page.screenshot({ path: shot('getting-started'), fullPage: true })
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeHidden()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText(/Last synced/)).toBeVisible()
  await page.screenshot({ path: shot('settings'), fullPage: true })

  // The highlight colour applies at once, stays after a reload, and has real shades behind it.
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
  const amber = await accent()
  await page.getByText('Teal', { exact: true }).click()
  await expect.poll(accent).not.toBe(amber)
  const muted = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--accent-muted)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  })
  expect(muted).toMatch(/color\(srgb|rgba/)
  await page.screenshot({ path: shot('settings-teal'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Teal' })).toBeChecked()
  await expect.poll(accent).not.toBe(amber)
  await page.getByText('Amber', { exact: true }).click()
  await expect.poll(accent).toBe(amber)

  await page.getByRole('link', { name: 'Transactions' }).click()
  const row = page.getByRole('row', { name: /Woolworths/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Pending')
  await page.screenshot({ path: shot('transactions') })

  await row.getByRole('button', { name: /Woolworths/ }).click()
  const drawer = page.getByRole('dialog', { name: 'Woolworths' })
  await expect(drawer).toBeVisible()
  const saved = page.waitForResponse((r) => r.url().includes('/category') && r.request().method() === 'PATCH')
  await drawer.getByLabel('Category').selectOption('groceries')
  expect((await saved).status()).toBe(200)
  await page.screenshot({ path: shot('drawer') })

  await page.reload()
  await expect(page.getByRole('row', { name: /Woolworths/ })).toContainText('Groceries')

  await page.getByRole('link', { name: 'Overview' }).click()
  const spent = page.getByText('Spent this month').locator('..')
  await expect(spent).not.toContainText('$0.00')
  await expect(page.getByRole('img', { name: 'Balance by account' })).toBeVisible()
  await page.screenshot({ path: shot('overview'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: shot('overview-mobile'), fullPage: true })
})
