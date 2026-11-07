import type { PayFlowEdgeDto, PayFlowNodeDto } from '../../shared/types'

/** Collects boxes and lines for a pay-flow chart. */
export class GraphBuilder {
  private readonly nodes = new Map<string, PayFlowNodeDto>()
  private readonly edges = new Map<string, PayFlowEdgeDto>()

  /** The first write for an id wins. */
  node(n: PayFlowNodeDto): void {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n)
  }

  /** Lines between the same two boxes add up; amounts of zero or less are ignored. */
  edge(from: string, to: string, cents: number): void {
    if (!(cents > 0)) return
    const id = `${from}->${to}`
    const existing = this.edges.get(id)
    if (existing) existing.amountCents += cents
    else this.edges.set(id, { id, from, to, amountCents: cents })
  }

  inCents(id: string): number {
    let sum = 0
    for (const e of this.edges.values()) if (e.to === id) sum += e.amountCents
    return sum
  }

  outCents(id: string): number {
    let sum = 0
    for (const e of this.edges.values()) if (e.from === id) sum += e.amountCents
    return sum
  }

  /** Drops boxes with no lines, except pays. */
  build(): { nodes: PayFlowNodeDto[]; edges: PayFlowEdgeDto[] } {
    const edges = [...this.edges.values()]
    const used = new Set<string>()
    for (const e of edges) {
      used.add(e.from)
      used.add(e.to)
    }
    const nodes = [...this.nodes.values()].filter((n) => n.kind === 'pay' || used.has(n.id))
    return { nodes, edges }
  }
}
