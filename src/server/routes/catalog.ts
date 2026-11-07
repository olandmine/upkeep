import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { categoryColorToken } from '../../shared/categories'
import type { CategoryDto } from '../../shared/types'
import type { AppDeps, AppEnv } from '../app'
import { requireUser } from '../auth/middleware'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { viewableAccountIds } from '../queries/scope'

export function listCategories(db: Db): CategoryDto[] {
  const rows = db.select().from(s.categories).orderBy(asc(s.categories.name)).all()
  const parentIds = rows.filter((r) => r.parentId === null).map((r) => r.id)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    colorToken: categoryColorToken(r.parentId ?? r.id, parentIds),
  }))
}

export function catalogRoutes(deps: AppDeps) {
  // Mounted at /api, so auth is per route: a router-wide .use() would also guard /api/setup and /api/auth.
  const auth = requireUser(deps)
  return new Hono<AppEnv>()
    .get('/categories', auth, (c) => c.json(listCategories(deps.db), 200))
    .get('/tags', auth, (c) =>
      c.json(
        // Only labels on transactions the viewer can see, so a hidden tag name doesn't leak.
        deps.db
          .selectDistinct({ label: s.transactionTags.label })
          .from(s.transactionTags)
          .innerJoin(s.transactions, eq(s.transactions.id, s.transactionTags.transactionId))
          .where(
            and(
              isNull(s.transactions.deletedAt),
              inArray(s.transactions.accountId, viewableAccountIds(deps.db, c.get('user').id, 'transactions')),
            ),
          )
          .orderBy(asc(s.transactionTags.label))
          .all()
          .map((t) => t.label),
        200,
      ),
    )
}
