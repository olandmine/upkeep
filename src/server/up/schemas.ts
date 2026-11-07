import { z } from 'zod'

// Lenient schemas: core fields are validated, everything else passes through (.loose()).

export const UpMoneySchema = z
  .object({ currencyCode: z.string(), value: z.string(), valueInBaseUnits: z.number().int() })
  .loose()

const ResourceId = z.object({ type: z.string(), id: z.string() }).loose()
const ToOne = z.object({ data: ResourceId.nullable() }).loose()
const OptionalToOne = ToOne.optional().transform((r) => r ?? { data: null })

export const UpAccountSchema = z
  .object({
    type: z.literal('accounts'),
    id: z.string(),
    attributes: z
      .object({
        displayName: z.string(),
        accountType: z.string(),
        ownershipType: z.string(),
        balance: UpMoneySchema,
        createdAt: z.string(),
      })
      .loose(),
  })
  .loose()

export const UpTransactionSchema = z
  .object({
    type: z.literal('transactions'),
    id: z.string(),
    attributes: z
      .object({
        status: z.enum(['HELD', 'SETTLED']),
        rawText: z.string().nullish(),
        description: z.string(),
        message: z.string().nullish(),
        isCategorizable: z.boolean(),
        roundUp: z.object({ amount: UpMoneySchema, boostPortion: UpMoneySchema.nullish() }).loose().nullish(),
        cashback: z.object({ description: z.string(), amount: UpMoneySchema }).loose().nullish(),
        amount: UpMoneySchema,
        foreignAmount: UpMoneySchema.nullish(),
        cardPurchaseMethod: z
          .object({ method: z.string(), cardNumberSuffix: z.string().nullish() })
          .loose()
          .nullish(),
        settledAt: z.string().nullish(),
        createdAt: z.string(),
        performingCustomer: z.object({ displayName: z.string() }).loose().nullish(),
        transactionType: z.string().nullish(),
      })
      .loose(),
    relationships: z
      .object({
        account: z.object({ data: ResourceId }).loose(),
        transferAccount: OptionalToOne,
        category: OptionalToOne,
        parentCategory: OptionalToOne,
        tags: z
          .object({ data: z.array(ResourceId) })
          .loose()
          .optional()
          .transform((r) => r ?? { data: [] }),
      })
      .loose(),
  })
  .loose()

export const UpCategorySchema = z
  .object({
    type: z.literal('categories'),
    id: z.string(),
    attributes: z.object({ name: z.string() }).loose(),
    relationships: z.object({ parent: ToOne }).loose(),
  })
  .loose()

export const UpPageSchema = z
  .object({
    data: z.array(z.unknown()),
    links: z.object({ next: z.string().nullish() }).loose().optional(),
  })
  .loose()

export type UpMoney = z.infer<typeof UpMoneySchema>
export type UpAccount = z.infer<typeof UpAccountSchema>
export type UpTransaction = z.infer<typeof UpTransactionSchema>
export type UpCategory = z.infer<typeof UpCategorySchema>
