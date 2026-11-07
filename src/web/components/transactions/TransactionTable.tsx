import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CategoryDto, TransactionDto, TransactionPage, TxFilters } from '../../../shared/types'
import { client, errorMessage, unwrap } from '../../lib/api'
import { combineTransfers, isCombined } from '../../lib/combine-transfers'
import { groupByDay } from '../../lib/group-by-day'
import { canMarkAsPay, canMarkAsRepayment } from '../../lib/pay'
import {
  accountsQuery,
  categoriesQuery,
  debtsQuery,
  invalidateAfterDebtEdit,
  invalidateAfterTransactionEdit,
  meQuery,
  payScheduleQuery,
  tagsQuery,
  transactionRepaymentQuery,
  transactionsQuery,
  usersQuery,
} from '../../lib/queries'
import { Money } from '../Money'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { TransactionDetail, TransactionDrawer } from './TransactionDrawer'
import { CategoryChip, Payee, TxAmount, TxBadges } from './TransactionRow'
import { TransferListItem, TransferTableRows } from './TransferRows'

const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' })
const COLUMN_COUNT = 7

/** One cell spanning every column (some hide below lg/xl), so the daily net stays right-aligned. */
export function DayHeaderRow({ label, netCents }: { label: string; netCents: number }) {
  return (
    <tr className="bg-sunken/60">
      <th scope="colgroup" colSpan={COLUMN_COUNT} className="type-caption px-4 py-1.5 font-medium text-fg-2">
        <span className="flex items-center justify-between gap-4">
          <span>{label}</span>
          <Money cents={netCents} signed />
        </span>
      </th>
    </tr>
  )
}

export function TransactionTable({ filters, emptyText = 'No transactions match these filters.' }: { filters: TxFilters; emptyText?: string | null }) {
  const queryClient = useQueryClient()
  const list = useInfiniteQuery(transactionsQuery(filters))
  const { data: categories = [] } = useQuery(categoriesQuery)
  const { data: allTags = [] } = useQuery(tagsQuery)
  const { data: users = [] } = useQuery(usersQuery)
  const { data: me } = useQuery(meQuery)
  const { data: accounts = [] } = useQuery(accountsQuery('everyone'))
  const { data: schedule } = useQuery(payScheduleQuery)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: budgetLine } = useQuery({
    queryKey: ['budget-line', selectedId],
    queryFn: () =>
      unwrap<{ budgetName: string; lineName: string | null } | null>(
        client.api.transactions[':id']['budget-line'].$get({ param: { id: selectedId! } }),
      ),
    enabled: Boolean(selectedId),
  })
  const { data: debts = [] } = useQuery(debtsQuery('everyone'))
  const editableDebts = debts.filter((d) => d.canEdit).map((d) => ({ id: d.id, name: d.name }))
  const { data: repaymentOf = null } = useQuery({
    ...transactionRepaymentQuery(selectedId ?? ''),
    enabled: Boolean(selectedId),
  })
  const toast = useToast()
  async function repaymentAction(request: Promise<Response>, success: string) {
    try {
      await unwrap(request)
      toast(success, 'success')
      await invalidateAfterDebtEdit(queryClient)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }
  async function markPay(transactionId: string) {
    try {
      await unwrap(client.api['pay-schedule'].$put({ json: { transactionId } }))
      toast('Pay schedule saved. Budgets now follow this pay.', 'success')
      for (const queryKey of [['pay-schedule'], ['pay-events'], ['budgets'], ['budget-period'], ['pay-plan'], ['standard-pay']]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const groups = useMemo(() => groupByDay(combineTransfers(items)), [items])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const categoryById = useMemo(() => new Map<string, CategoryDto>(categories.map((c) => [c.id, c])), [categories])
  const spentBy = (tx: TransactionDto) =>
    users.find((u) => u.id === tx.performedByUserId)?.displayName ?? tx.performingCustomer ?? null
  const selected = items.find((t) => t.id === selectedId) ?? null

  // Infinite scroll, with a "Load more" button as the keyboard/no-observer fallback.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  function replaceInCaches(updated: TransactionDto) {
    queryClient.setQueriesData<InfiniteData<TransactionPage>>({ queryKey: ['transactions'] }, (old) =>
      old
        ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === updated.id ? updated : t)) })) }
        : old,
    )
    void queryClient.invalidateQueries({ queryKey: ['overview'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
  }

  const write = async (pending: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>) => {
    const updated = await unwrap<TransactionDto>(pending)
    replaceInCaches(updated)
    void invalidateAfterTransactionEdit(queryClient, updated.id)
  }

  if (list.isPending) return <p className="type-body py-8 text-fg-3">Loading transactions…</p>
  if (list.isError) return <p className="type-body py-8 text-negative">Couldn&apos;t load transactions.</p>
  // `null` says nothing: the list may just be hidden, so "none here" would be untrue.
  if (!items.length) return emptyText === null ? null : <p className="type-body rounded-lg border border-line bg-raised p-8 text-center text-fg-3">{emptyText}</p>

  return (
    <>
      {/* md and up: a real table */}
      <div className="hidden overflow-hidden rounded-lg border border-line bg-raised shadow-[inset_0_1px_0_var(--highlight-top)] md:block">
        <table className="w-full table-fixed border-collapse">
          <thead className="type-caption sticky top-0 z-10 bg-sunken text-left text-fg-3">
            <tr>
              <th scope="col" className="w-20 px-4 py-2.5 font-medium">Date</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Payee</th>
              <th scope="col" className="w-44 px-4 py-2.5 font-medium">Category</th>
              <th scope="col" className="hidden w-36 px-4 py-2.5 font-medium lg:table-cell">Account</th>
              <th scope="col" className="hidden w-28 px-4 py-2.5 font-medium xl:table-cell">Spent by</th>
              <th scope="col" className="w-24 px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="w-32 px-4 py-2.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.date}>
              <DayHeaderRow label={g.label} netCents={g.netCents} />
              {g.items.map((tx) => isCombined(tx) ? (
                <TransferTableRows
                  key={tx.id}
                  row={tx}
                  date={shortDate.format(new Date(tx.createdAt))}
                  expanded={expanded.has(tx.id)}
                  onToggle={() => toggleExpanded(tx.id)}
                  onSelect={setSelectedId}
                  spentBy={spentBy}
                />
              ) : (
                <tr
                  key={tx.id}
                  onClick={() => setSelectedId(tx.id)}
                  className="h-12 cursor-pointer border-t border-line transition-colors duration-150 hover:bg-elevated"
                >
                  <td className="num px-4 text-fg-3">{shortDate.format(new Date(tx.createdAt))}</td>
                  <td className="px-4">
                    <button type="button" className="w-full min-w-0 text-left" onClick={() => setSelectedId(tx.id)}>
                      <Payee tx={tx} />
                    </button>
                  </td>
                  <td className="truncate px-4">
                    <CategoryChip category={tx.categoryId ? categoryById.get(tx.categoryId) : undefined} />
                  </td>
                  <td className="hidden truncate px-4 lg:table-cell">{tx.accountName}</td>
                  <td className="hidden truncate px-4 xl:table-cell">{spentBy(tx) ?? '—'}</td>
                  <td className="px-4">
                    <TxBadges tx={tx} />
                  </td>
                  <td className="px-4 text-right">
                    <TxAmount tx={tx} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* below md: stacked rows */}
      <div className="flex flex-col gap-4 md:hidden">
        {groups.map((g) => (
          <section key={g.date} aria-label={g.label}>
            <div className="type-caption flex justify-between px-1 pb-1.5 text-fg-2">
              <span>{g.label}</span>
              <Money cents={g.netCents} signed />
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
              {g.items.map((tx) => isCombined(tx) ? (
                <TransferListItem
                  key={tx.id}
                  row={tx}
                  expanded={expanded.has(tx.id)}
                  onToggle={() => toggleExpanded(tx.id)}
                  onSelect={setSelectedId}
                />
              ) : (
                <li key={tx.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(tx.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elevated"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <Payee tx={tx} />
                      <span className="flex flex-wrap items-center gap-2">
                        <CategoryChip category={tx.categoryId ? categoryById.get(tx.categoryId) : undefined} />
                        <TxBadges tx={tx} />
                      </span>
                    </span>
                    <TxAmount tx={tx} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div ref={sentinel} className="flex justify-center py-4">
        {hasNextPage && (
          <Button variant="ghost" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>

      <TransactionDrawer open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)} title={selected?.description ?? ''}>
        {selected && (
          <TransactionDetail
            tx={selected}
            categories={categories}
            allTags={allTags}
            spentBy={spentBy(selected)}
            budgetLine={budgetLine}
            pay={
              canMarkAsPay(selected, accounts, me?.id)
                ? { hasSchedule: Boolean(schedule), onMark: () => void markPay(selected.id) }
                : undefined
            }
            repayment={
              selected && canMarkAsRepayment(selected)
                ? {
                    current: repaymentOf,
                    debts: editableDebts,
                    onMark: (debtId, matchFuture) =>
                      void repaymentAction(
                        client.api.debts[':id'].repayments.$post({
                          param: { id: debtId },
                          json: { transactionId: selected.id, matchFuture },
                        }),
                        `Marked as a repayment for ${editableDebts.find((d) => d.id === debtId)?.name ?? 'that debt'}`,
                      ),
                    onNotRepayment: (debtId) =>
                      void repaymentAction(
                        client.api.debts[':id'].exclusions.$post({
                          param: { id: debtId },
                          json: { transactionId: selected.id },
                        }),
                        'Not counted as a repayment',
                      ),
                  }
                : undefined
            }
            onCategory={(categoryId) =>
              write(client.api.transactions[':id'].category.$patch({ param: { id: selected.id }, json: { categoryId } }))
            }
            onAddTag={(label) =>
              write(client.api.transactions[':id'].tags.$post({ param: { id: selected.id }, json: { labels: [label] } }))
            }
            onRemoveTag={(label) =>
              write(client.api.transactions[':id'].tags.$delete({ param: { id: selected.id }, json: { labels: [label] } }))
            }
          />
        )}
      </TransactionDrawer>
    </>
  )
}
