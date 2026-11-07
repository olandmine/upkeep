import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { DebtPatchDto, HelpImportSummaryDto } from '../../shared/types'
import { SearchLink } from '../components/AppLink'
import { money } from '../components/budgets/format'
import { AddEntryForm, AddEntryMenu, ENTRY_FORM_TITLE, type EntryFormKind } from '../components/debts/AddEntryForm'
import { PayoffLine } from '../components/debts/DebtCard'
import { DebtActivity } from '../components/debts/DebtActivity'
import { DebtForm } from '../components/debts/DebtForm'
import { RepaymentsSection } from '../components/debts/DebtSections'
import { DebtTimelineChart } from '../components/debts/DebtTimelineChart'
import { HelpImportCard } from '../components/debts/HelpImport'
import { buildingUpCaption, FEE_FREQUENCY_LABEL, FREQUENCY_LABEL, KIND_LABEL, rateText } from '../components/debts/format'
import { UpdateBalanceForm } from '../components/debts/UpdateBalanceForm'
import { PrivateNotice } from '../components/sharing/PrivateNotice'
import { Page } from '../components/shell/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { client, errorMessage, unwrap } from '../lib/api'
import { debtQuery, invalidateAfterDebtEdit, meQuery } from '../lib/queries'

export const Route = createFileRoute('/_app/debts/$debtId')({
  component: DebtPage,
})

function DebtPage() {
  const { debtId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: me } = useQuery(meQuery)
  const { data: debt, isError } = useQuery(debtQuery(debtId))
  const [editing, setEditing] = useState(false)
  const [updating, setUpdating] = useState(false)
  // The Add… form being filled in. Editing an entry happens inline in its Activity row.
  const [entryForm, setEntryForm] = useState<EntryFormKind | null>(null)
  const [importing, setImporting] = useState(false)

  const param = { param: { id: debtId } }
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidateAfterDebtEdit(queryClient),
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const act = (fn: () => Promise<unknown>) => run.mutateAsync(fn).then(() => {})
  const caption = debt ? buildingUpCaption(debt) : null

  if (isError) {
    return (
      <Page title="Debt" showScope={false}>
        <p className="text-negative">Couldn&apos;t load this debt.</p>
      </Page>
    )
  }
  if (!debt)
    return (
      <Page title="Debt" showScope={false}>
        {null}
      </Page>
    )

  return (
    <Page
      title={debt.name}
      showScope={false}
      actions={
        debt.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setUpdating(true)}>
              Update balance
            </Button>
            <AddEntryMenu onPick={setEntryForm} allowRate={debt.kind !== 'bnpl'} />
            {debt.kind === 'hecs' && <Button onClick={() => setImporting(true)}>Import statement</Button>}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmDialog
              trigger={<Button variant="ghost">Delete</Button>}
              description={`Delete ${debt.name}, its balances and its repayment rules?`}
              confirmLabel="Delete"
              onConfirm={() =>
                void act(() => unwrap(client.api.debts[':id'].$delete(param))).then(() =>
                  navigate({ to: '/debts' }),
                )
              }
            />
          </div>
        )
      }
    >
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="type-kpi-xl num text-fg">{money(debt.balanceCents)}</span>
          {caption && <span className="type-caption num text-fg-3">{caption}</span>}
          <PayoffLine debt={debt} />
          {debt.projection && (
            <span className="type-caption num text-fg-3">{`Interest to pay ${money(debt.projection.totalInterestCents)}`}</span>
          )}
        </div>
        <div className="type-caption mt-3 flex flex-wrap items-center gap-2 text-fg-3">
          <Badge>{KIND_LABEL[debt.kind]}</Badge>
          <span>{debt.ownerName}</span>
          {debt.kind !== 'bnpl' && <span>{rateText(debt.rateBp)}</span>}
          <span>{`${money(debt.repaymentCents)} ${FREQUENCY_LABEL[debt.repaymentFrequency].toLowerCase()}`}</span>
          {debt.fee && (
            <span>{`${money(debt.fee.amountCents)} fee ${FEE_FREQUENCY_LABEL[debt.fee.frequency].toLowerCase()}`}</span>
          )}
          {debt.estimated && <span>Estimated</span>}
        </div>
      </Card>

      {updating && (
        <Card>
          <CardHeader
            title="Update balance"
            action={
              <Button variant="ghost" onClick={() => setUpdating(false)}>
                Cancel
              </Button>
            }
          />
          <UpdateBalanceForm
            existingDates={debt.balances.map((b) => b.asOf)}
            onSave={(body) =>
              void act(() => unwrap(client.api.debts[':id'].balances.$post({ ...param, json: body }))).then(
                () => setUpdating(false),
              )
            }
          />
        </Card>
      )}

      {entryForm && (
        <Card>
          <CardHeader
            title={`Add ${ENTRY_FORM_TITLE[entryForm].toLowerCase()}`}
            action={
              <Button variant="ghost" onClick={() => setEntryForm(null)}>
                Cancel
              </Button>
            }
          />
          <AddEntryForm
            key={entryForm}
            kind={entryForm}
            onCancel={() => setEntryForm(null)}
            onSave={(body) =>
              void act(() =>
                body.kind === 'rate'
                  ? unwrap(client.api.debts[':id'].rates.$post({ ...param, json: body }))
                  : unwrap(client.api.debts[':id'].entries.$post({ ...param, json: body })),
              ).then(() => setEntryForm(null))
            }
          />
        </Card>
      )}

      {importing && (
        <Card>
          <CardHeader title="Import ATO statement" />
          <HelpImportCard
            debtName={debt.name}
            onPreview={(csv) =>
              unwrap<HelpImportSummaryDto>(client.api.debts[':id'].import.$post({ ...param, json: { csv, dryRun: true } }))
            }
            onImport={(csv) =>
              run
                .mutateAsync(() =>
                  unwrap<HelpImportSummaryDto>(client.api.debts[':id'].import.$post({ ...param, json: { csv, dryRun: false } })),
                )
                .then((done) => {
                  setImporting(false)
                  toast(`Imported ${(done as HelpImportSummaryDto).rows} rows from the ATO statement.`)
                })
            }
            onCancel={() => setImporting(false)}
          />
        </Card>
      )}

      {editing && me && (
        <Card>
          <CardHeader title="Edit debt" />
          <DebtForm
            debt={debt}
            balance={debt.balances.reduce<(typeof debt.balances)[number] | undefined>(
              (latest, b) => (!latest || b.asOf > latest.asOf ? b : latest),
              undefined,
            )}
            rates={debt.rates}
            onRemoveRate={(rateId) =>
              void act(() => unwrap(client.api.debts[':id'].rates[':rateId'].$delete({ param: { id: debtId, rateId } })))
            }
            me={me}
            onSave={(patch: DebtPatchDto, balance, rate) =>
              act(async () => {
                await unwrap(client.api.debts[':id'].$patch({ ...param, json: patch }))
                if (rate) await unwrap(client.api.debts[':id'].rates.$post({ ...param, json: rate }))
                if (!balance) return
                // Saved at its (new) date first, so a failure leaves the old balance in place.
                const { balanceCents, asOf, replacesId } = balance
                await unwrap(client.api.debts[':id'].balances.$post({ ...param, json: { balanceCents, asOf } }))
                if (replacesId) {
                  await unwrap(
                    client.api.debts[':id'].balances[':balanceId'].$delete({ param: { id: debtId, balanceId: replacesId } }),
                  )
                }
              }).then(() => setEditing(false))
            }
            onCancel={() => setEditing(false)}
          />
        </Card>
      )}

      <Card>
        <DebtTimelineChart timeline={debt.timeline} balances={debt.balances} />
      </Card>

      {/* A joint debt too: their repayments can move its balance with no row to show for it. */}
      {me && debt.ownerUserId !== me.id && <PrivateNotice needs="transactions" />}

      <Card>
        <CardHeader title="Activity" />
        <DebtActivity
          rows={debt.activity}
          charge={debt.interest.charge}
          canEdit={debt.canEdit}
          canRemoveCheck={debt.balances.length > 1}
          canRemoveRate={debt.rates.length > 1}
          LinkComponent={SearchLink}
          onEditInterest={(chargeDate, cents) =>
            void act(() => {
              // The route's param schema only types :chargeDate, but the URL still needs :id.
              const interestParam = { id: debtId, chargeDate } as { chargeDate: string }
              return cents === null
                ? unwrap(client.api.debts[':id'].interest[':chargeDate'].$delete({ param: interestParam }))
                : unwrap(
                    client.api.debts[':id'].interest[':chargeDate'].$put({
                      param: interestParam,
                      json: { amountCents: cents },
                    }),
                  )
            })
          }
          onSaveEntry={(entryId, body) =>
            act(() =>
              unwrap(client.api.debts[':id'].entries[':entryId'].$patch({ param: { id: debtId, entryId }, json: body })),
            )
          }
          onDeleteEntry={(entryId) =>
            void act(() => unwrap(client.api.debts[':id'].entries[':entryId'].$delete({ param: { id: debtId, entryId } })))
          }
          onRemoveCheck={(balanceId) =>
            void act(() =>
              unwrap(client.api.debts[':id'].balances[':balanceId'].$delete({ param: { id: debtId, balanceId } })),
            )
          }
          onRemoveRate={(rateId) =>
            void act(() => unwrap(client.api.debts[':id'].rates[':rateId'].$delete({ param: { id: debtId, rateId } })))
          }
          onNotRepayment={(transactionId) =>
            void act(() => unwrap(client.api.debts[':id'].exclusions.$post({ ...param, json: { transactionId } })))
          }
        />
      </Card>

      <Card>
        <CardHeader title="Repayments" />
        <RepaymentsSection
          rules={debt.repaymentRules}
          exclusions={debt.exclusions}
          hasRepayments={debt.activity.some((r) => r.kind === 'repayment')}
          canEdit={debt.canEdit}
          LinkComponent={SearchLink}
          onStopMatching={(ruleId) =>
            void act(() =>
              unwrap(client.api.debts[':id']['repayment-rules'][':ruleId'].$delete({ param: { id: debtId, ruleId } })),
            )
          }
          onUndo={(transactionId) =>
            void act(() =>
              unwrap(
                client.api.debts[':id'].exclusions[':transactionId'].$delete({
                  param: { id: debtId, transactionId },
                }),
              ),
            )
          }
        />
      </Card>
    </Page>
  )
}
