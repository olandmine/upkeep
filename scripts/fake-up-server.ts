// Fake Up API over HTTP for end-to-end tests and local UI work. Token: up:yeah:e2e
import { serve } from '@hono/node-server'
import { buildAccount, buildTransaction } from '../tests/fake-up/builders'
import { createFakeUp } from '../tests/fake-up/fake-up'

const port = Number(process.env.FAKE_UP_PORT ?? 4010)
const fake = createFakeUp()

fake.addAccount(buildAccount({ id: 'acc-spending', displayName: 'Spending', balanceCents: 254_312 }))
fake.addAccount(buildAccount({ id: 'acc-savings', displayName: 'Rainy Day', accountType: 'SAVER', balanceCents: 1_250_000 }))
fake.addAccount(buildAccount({ id: 'acc-2up', displayName: '2Up Bills', ownershipType: 'JOINT', balanceCents: 84_210 }))
fake.addAccount(
  buildAccount({ id: 'acc-rent', displayName: 'Rent', accountType: 'SAVER', ownershipType: 'JOINT', balanceCents: 164_446 }),
)
fake.addAccount(buildAccount({ id: 'acc-food', displayName: 'Food', accountType: 'SAVER', balanceCents: 20_000 }))
fake.addCustomer('up:yeah:e2e', ['acc-spending', 'acc-savings', 'acc-2up', 'acc-rent', 'acc-food'])

const merchants = [
  { description: 'Coles', amount: -8_740, categoryId: 'groceries', parentCategoryId: 'home' },
  { description: 'Guzman y Gomez', amount: -2_390, categoryId: 'takeaway', parentCategoryId: 'good-life' },
  { description: 'Opal Travel', amount: -1_000, categoryId: 'public-transport', parentCategoryId: 'transport' },
  { description: 'Ampol', amount: -6_512, categoryId: 'fuel', parentCategoryId: 'transport' },
  { description: 'The Grounds', amount: -3_450, categoryId: 'restaurants-and-cafes', parentCategoryId: 'good-life' },
  { description: 'Chemist Warehouse', amount: -2_799, categoryId: 'health-and-medical', parentCategoryId: 'personal' },
]

const day = 86_400_000
const now = Date.now()
for (let i = 0; i < 56; i++) {
  const m = merchants[i % merchants.length]
  fake.addTransaction(
    buildTransaction({
      id: `e2e-${i}`,
      accountId: i % 4 === 0 ? 'acc-2up' : 'acc-spending',
      amountCents: m.amount - (i % 7) * 113,
      createdAt: new Date(now - i * day * 1.4 - 3_600_000).toISOString(),
      description: m.description,
      categoryId: m.categoryId,
      parentCategoryId: m.parentCategoryId,
      cardMethod: 'CONTACTLESS',
      cardSuffix: '4242',
      performingCustomer: i % 4 === 0 ? 'Owner' : null,
    }),
  )
}
// Fortnightly pay for 12 weeks; Up's pay split moves rent to the joint Rent Saver within the hour,
// and a round-up lands in Food (round-ups must never count as a planned transfer).
for (let i = 0; i <= 6; i++) {
  const paidAt = now - i * 14 * day - 2 * 3_600_000
  const at = (ms: number) => new Date(paidAt + ms).toISOString()
  fake.addTransaction(
    buildTransaction({
      id: `e2e-pay-${i}`,
      accountId: 'acc-spending',
      amountCents: 412_000,
      createdAt: at(0),
      description: 'ACME PAY',
      isCategorizable: false,
      transactionType: 'Salary',
    }),
  )
  for (const [id, accountId, amountCents, transferAccountId] of [
    [`e2e-rent-out-${i}`, 'acc-spending', -80_000, 'acc-rent'],
    [`e2e-rent-in-${i}`, 'acc-rent', 80_000, 'acc-spending'],
  ] as const) {
    fake.addTransaction(
      buildTransaction({
        id,
        accountId,
        amountCents,
        createdAt: at(3_600_000),
        description: accountId === 'acc-rent' ? 'Transfer from Spending' : 'Transfer to Rent',
        transferAccountId,
        isCategorizable: false,
        transactionType: 'Transfer',
      }),
    )
  }
  fake.addTransaction(
    buildTransaction({
      id: `e2e-roundup-${i}`,
      accountId: 'acc-food',
      amountCents: 196,
      createdAt: at(5_400_000),
      description: 'Round Up',
      transferAccountId: 'acc-spending',
      isCategorizable: false,
      transactionType: 'Round Up',
    }),
  )
}
fake.addTransaction(
  buildTransaction({
    id: 'e2e-transfer',
    accountId: 'acc-spending',
    amountCents: -50_000,
    createdAt: new Date(now - 5 * 3_600_000).toISOString(),
    description: 'Transfer to Rainy Day',
    transferAccountId: 'acc-savings',
    isCategorizable: false,
  }),
)
fake.addTransaction(
  buildTransaction({
    id: 'e2e-woolies',
    accountId: 'acc-spending',
    amountCents: -4_321,
    createdAt: new Date(now - 30 * 60_000).toISOString(),
    status: 'HELD',
    description: 'Woolworths',
    message: 'weekly shop',
  }),
)

// Monthly car loan repayments at local midnight on the 1st of this month and the three before (Phase 3
// debts flow). Local, like the app: the e2e config runs both servers with the same TZ, so the months agree.
const today = new Date(now)
for (let k = 0; k < 4; k++) {
  fake.addTransaction(
    buildTransaction({
      id: `e2e-car-${k}`,
      accountId: 'acc-spending',
      amountCents: -45_000,
      createdAt: new Date(today.getFullYear(), today.getMonth() - k, 1).toISOString(),
      description: 'ACME CAR FINANCE',
      transactionType: 'Purchase',
    }),
  )
}

serve({ fetch: fake.app.fetch, port }, () => console.log(`fake Up API on http://localhost:${port}/api/v1`))
