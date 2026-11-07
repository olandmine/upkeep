import { expect, test, type Page } from '@playwright/test'

const shot = (name: string) => `test-results/screens/${name}.png`
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function logIn(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Log in/ }).click()
}

// Runs last (its own project): adding a partner is permanent in the e2e database. The owner has the
// seeded Up data and is on Full transparency; Sam is the viewer and has no Up connection.
test('each person chooses what the other sees, and the server holds to it', async ({ page, browser, baseURL }) => {
  await logIn(page, 'owner', 'correct horse')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  // 1. The owner adds a partner.
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Add partner' }).click()
  await page.getByLabel("Partner's name").fill('Sam')
  await page.getByLabel('Their Up $handle').fill('$sam')
  await page.getByLabel('Initial password').fill('second horse')
  await page.getByRole('button', { name: 'Create login' }).click()
  await expect(page.getByText('@sam')).toBeVisible()
  const accounts = await (await page.context().request.get('/api/accounts')).json()
  const ownersAccount = (accounts as { id: string; displayName: string }[]).find((a) => a.displayName === 'Spending')!
  expect(ownersAccount).toBeTruthy()

  const setLevel = async (name: RegExp) => {
    await page.goto('/settings')
    const saved = page.waitForResponse((r) => r.url().includes('/api/me') && r.request().method() === 'PATCH')
    await page.getByRole('radio', { name }).click()
    expect((await saved).status()).toBe(200)
  }

  // 2. Sam logs in, must choose before going on, and picks No sharing.
  const partnerContext = await browser.newContext({ baseURL, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
  const partner = await partnerContext.newPage()
  await logIn(partner, 'sam', 'second horse')
  await expect(partner).toHaveURL(/\/sharing$/)
  await expect(partner.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await partner.screenshot({ path: shot('sharing-chooser'), fullPage: true })
  for (const width of [390, 360]) {
    await partner.setViewportSize({ width, height: 844 })
    expect(await noSideways(partner), `/sharing at ${width}px`).toBe(true)
    if (width === 390) await partner.screenshot({ path: shot('sharing-chooser-mobile'), fullPage: true })
  }
  await partner.setViewportSize({ width: 1440, height: 900 })
  await partner.getByRole('radio', { name: /No sharing/ }).check()
  await partner.getByRole('button', { name: 'Continue' }).click()
  await expect(partner).toHaveURL(/\/connect$/)
  await partner.getByRole('button', { name: 'Skip for now' }).click()
  await expect(partner.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(partner.getByText('Owner chose your first one. Make it yours so only you can log in.')).toBeVisible()
  await partner.getByRole('button', { name: 'Hide' }).click()

  // The owner's Settings card, at desktop and phone widths.
  await page.goto('/settings')
  const card = page.getByRole('region', { name: 'Sharing' })
  await expect(card).toBeVisible()
  await page.screenshot({ path: shot('sharing-settings'), fullPage: true })
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await noSideways(page), `Settings at ${width}px`).toBe(true)
    if (width === 390) await page.screenshot({ path: shot('sharing-settings-mobile'), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // 3. Hide transactions: no owner rows, but the accounts stay.
  await setLevel(/Hide transactions/)
  await partner.goto('/transactions')
  await expect(partner.getByText('Owner keeps their transactions private.')).toBeVisible()
  await expect(partner.getByRole('row', { name: /Woolworths/ })).toHaveCount(0)
  await partner.screenshot({ path: shot('sharing-notice') })
  for (const width of [390, 360]) {
    await partner.setViewportSize({ width, height: 844 })
    expect(await noSideways(partner), `notice on /transactions at ${width}px`).toBe(true)
    if (width === 390) await partner.screenshot({ path: shot('sharing-notice-mobile'), fullPage: true })
  }
  await partner.setViewportSize({ width: 1440, height: 900 })
  await partner.goto('/accounts')
  await expect(partner.getByText('Spending', { exact: true }).first()).toBeVisible()
  await expect(partner.getByText('Rainy Day').first()).toBeVisible()

  // 4. Balances only: accounts stay, other pages explain.
  await setLevel(/Balances only/)
  await partner.goto('/accounts')
  await expect(partner.getByText('Spending', { exact: true }).first()).toBeVisible()
  await partner.goto('/budgets')
  await partner.getByRole('button', { name: "Owner's pay" }).click()
  await expect(partner.getByText('Owner shares account balances only.')).toBeVisible()
  await partner.goto('/?scope=partner')
  await expect(partner.getByText('Owner shares account balances only.')).toBeVisible()
  await expect(partner.getByText('Total balance')).toBeVisible()
  await expect(partner.getByText('Spent this month')).toHaveCount(0)
  await partner.screenshot({ path: shot('sharing-overview-balances'), fullPage: true })
  await partner.goto('/net-worth?scope=partner')
  await expect(partner.getByText('Owner shares account balances only.')).toBeVisible()
  await expect(partner.getByRole('group', { name: 'Range' })).toBeVisible()

  // 5. No sharing: nothing of the owner's personal accounts.
  await setLevel(/No sharing/)
  await partner.goto('/accounts')
  await expect(partner.getByText("Owner doesn't share their personal accounts.")).toBeVisible()
  await expect(partner.getByText('Rainy Day')).toHaveCount(0)
  // In Partner scope the notice is all there is: no zeros, and no claim that they haven't connected.
  const nothing = "Owner doesn't share their personal accounts."
  await partner.goto('/accounts?scope=partner')
  await expect(partner.getByText(nothing)).toBeVisible()
  await expect(partner.getByText("Your partner hasn't connected Up yet.")).toHaveCount(0)
  await partner.goto('/?scope=partner')
  await expect(partner.getByText(nothing)).toBeVisible()
  await expect(partner.getByText('Total balance')).toHaveCount(0)
  await partner.screenshot({ path: shot('sharing-overview-none'), fullPage: true })
  await partner.goto('/net-worth?scope=partner')
  await expect(partner.getByText(nothing)).toBeVisible()
  await expect(partner.getByRole('group', { name: 'Range' })).toHaveCount(0)

  // 6. Asking for the account directly is a 404 too.
  const direct = await partnerContext.request.get(`/api/accounts/${ownersAccount.id}`)
  expect(direct.status()).toBe(404)

  // 7. Full transparency brings it all back.
  await setLevel(/Full transparency/)
  await partner.goto('/transactions')
  await expect(partner.getByRole('row', { name: /Woolworths/ })).toBeVisible()

  await partnerContext.close()
})
