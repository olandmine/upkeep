/** The highlight colours a person can pick. No red or green, which mean losses and gains. */
export const ACCENTS = ['amber', 'blue', 'violet', 'rose', 'teal', 'slate'] as const

export type Accent = (typeof ACCENTS)[number]
