import type { PayFlowDto } from '../../../shared/types'
import { Money } from '../Money'
import { pctOf, pctText } from './display'

/** "Show as table": one row per line, largest first. */
export function PayFlowTable({ flow }: { flow: PayFlowDto }) {
  const labels = new Map(flow.nodes.map((n) => [n.id, n.label]))
  // An account's spending is on its box in the chart; here it's a row like any other.
  const spent = flow.nodes
    .filter((n) => (n.spentCents ?? 0) > 0)
    .map((n) => ({ id: `${n.id}->spent`, from: n.id, to: 'Spent', amountCents: n.spentCents! }))
  const interest = flow.nodes
    .filter((n) => (n.interestCents ?? 0) > 0)
    .map((n) => ({ id: `interest->${n.id}`, from: 'Interest', to: n.id, amountCents: n.interestCents! }))
  const rows = [...flow.edges, ...spent, ...interest].sort((a, b) => b.amountCents - a.amountCents)
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="type-caption w-full">
        <caption className="sr-only">Where the pay went</caption>
        <thead>
          <tr className="text-left text-fg-3">
            <th scope="col" className="py-1 font-medium">
              From
            </th>
            <th scope="col" className="py-1 font-medium">
              To
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-line">
              <td className="py-1 text-fg-2">{labels.get(e.from) ?? e.from}</td>
              <td className="py-1 text-fg-2">{labels.get(e.to) ?? e.to}</td>
              <td className="py-1 text-right text-fg">
                <Money cents={e.amountCents} />
              </td>
              <td className="num py-1 text-right text-fg-2">
                {pctText(pctOf(e.amountCents, flow.baseCents), e.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
