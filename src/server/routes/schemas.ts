import { z } from 'zod'

export const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200)

export const UpDisplayNameSchema = z.string().trim().max(80).nullable().optional()

export const NewUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Up $handle is required')
    .max(50)
    .regex(/^\$?[a-zA-Z0-9._-]+$/, 'Up $handle can use letters, numbers, dots, dashes and underscores'),
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  password: PasswordSchema,
})
