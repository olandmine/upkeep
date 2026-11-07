import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, type EdgeProps, type NodeProps } from '@xyflow/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SharingLevel } from '../../src/shared/sharing'
import type { PayFlowDto, Scope } from '../../src/shared/types'
import { FlowBox, type FlowBoxNode } from '../../src/web/components/payflow/FlowBox'
import { PayFlowCard, ZoomButtons } from '../../src/web/components/payflow/PayFlowCard'
import { StreamEdge, type StreamEdgeType } from '../../src/web/components/payflow/StreamEdge'
import { ToastProvider } from '../../src/web/components/ui/Toast'

// React Flow needs layout APIs jsdom lacks; the real canvas is covered by the E2E.
vi.mock('../../src/web/components/payflow/PayFlowCanvas', () => ({
  PayFlowCanvas: ({
    flow,
    onMove,
  }: {
    flow: PayFlowDto
    onMove: (id: string, x: number, y: number) => void
  }) => (
    <div>
      {flow.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onMove(n.id, 10, 20)}>
          {n.label}
        </button>
      ))}
    </div>
  ),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flow = (over: Partial<PayFlowDto> = {}): PayFlowDto => ({
  state: 'ready',
  cycle: { start: '2026-10-14', end: null, prevDate: '2026-09-30', nextDate: null, isCurrent: true },
  baseCents: 320_000,
  baseLabel: 'pay',
  overAllocatedCents: null,
  nodes: [
    {
      id: 'pay:u1',
      kind: 'pay',
      label: 'Pay',
      caption: 'Acme Pty · 14 Oct',
      amountCents: 320_000,
      colorToken: 'positive',
      href: null,
    },
    {
      id: 'account:a1',
      kind: 'account',
      label: 'Spending',
      caption: 'In $3,200.00 · kept $2,000.00',
      amountCents: 320_000,
      colorToken: 'cat-blue',
      href: '/accounts/a1',
    },
    {
      id: 'spent:a1',
      kind: 'sink',
      label: 'Spent',
      caption: 'from Spending',
      amountCents: 120_000,
      colorToken: 'cat-slate',
      href: null,
    },
  ],
  edges: [
    { id: 'e2', from: 'account:a1', to: 'spent:a1', amountCents: 120_000 },
    { id: 'e1', from: 'pay:u1', to: 'account:a1', amountCents: 320_000 },
  ],
  ...over,
})

interface Call {
  method: string
  path: string
  body: unknown
}
let calls: Call[] = []

/** A stand-in API: pay flow from `payFlow`, and a layout store that PUT and DELETE change. */
function mockApi({
  payFlow = () => flow(),
  positions = {},
  putStatus = 204,
  partnerLevel = 'full',
}: {
  payFlow?: (q: URLSearchParams) => PayFlowDto | Response
  positions?: Record<string, { x: number; y: number }>
  putStatus?: number
  partnerLevel?: SharingLevel
} = {}) {
  calls = []
  let saved = positions
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path: decodeURIComponent(url.pathname) + url.search, body })
      const person = (id: string, displayName: string, sharingLevel: SharingLevel) => ({ id, displayName, sharingLevel })
      if (url.pathname === '/api/me') return Response.json(person('u1', 'Alex', 'full'))
      if (url.pathname === '/api/users')
        return Response.json([person('u1', 'Alex', 'full'), person('u2', 'Sam', partnerLevel)])
      if (url.pathname === '/api/pay-flow') {
        const out = payFlow(url.searchParams)
        return out instanceof Response ? out : Response.json(out)
      }
      if (url.pathname.startsWith('/api/flow-layouts/')) {
        if (method === 'GET') return Response.json({ positions: saved })
        if (method === 'PUT' && putStatus !== 204)
          return Response.json({ error: 'Too many boxes' }, { status: putStatus })
        saved = method === 'PUT' ? (body as { positions: typeof saved }).positions : {}
        return new Response(null, { status: 204 })
      }
      return Response.json({ error: 'Not found' }, { status: 404 })
    }),
  )
}

const paths = () => calls.map((c) => c.path)

function renderCard(scope: Scope = 'me') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PayFlowCard scope={scope} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

test('pills switch the view', async () => {
  mockApi()
  renderCard()
  expect(screen.getByRole('heading', { name: 'Where the pay went' })).toBeInTheDocument()
  await screen.findByRole('button', { name: 'Pay' })
  expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts')
  expect(paths()).toContain('/api/flow-layouts/me:actual:accounts')
  expect(screen.getByRole('button', { name: 'Actual' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: 'Planned' }))
  await userEvent.click(screen.getByRole('button', { name: 'Budget' }))
  await waitFor(() => expect(paths()).toContain('/api/pay-flow?scope=me&mode=planned&group=budget'))
  expect(paths()).toContain('/api/flow-layouts/me:planned:budget')
  expect(screen.getByRole('button', { name: 'Planned' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Budget' })).toHaveAttribute('aria-pressed', 'true')
})

test('timeframes: Month asks for months, steps by month, and a new timeframe starts at today', async () => {
  mockApi({
    payFlow: (q) =>
      q.get('range') === 'month'
        ? flow({ cycle: { start: '2026-10-01', end: null, prevDate: '2026-09-01', nextDate: null, isCurrent: true } })
        : flow(),
  })
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  expect(screen.getByRole('button', { name: 'Pay cycle' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: 'Month' }))
  await waitFor(() => expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&range=month'))
  expect(await screen.findByText('Oct 2026')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
  await waitFor(() =>
    expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&range=month&date=2026-09-01'),
  )
  await userEvent.click(screen.getByRole('button', { name: 'FY' }))
  await waitFor(() => expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&range=fy'))
})

test('show as table', async () => {
  mockApi()
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))

  const [head, ...rows] = screen.getAllByRole('row')
  expect(
    within(head)
      .getAllByRole('columnheader')
      .map((c) => c.textContent),
  ).toEqual(['From', 'To', 'Amount', '%'])
  expect(rows).toHaveLength(2)
  const cells = (row: HTMLElement) =>
    within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent)
  expect(cells(rows[0])).toEqual(['Pay', 'Spending', '$3,200.00', '100%'])
  expect(cells(rows[1])).toEqual(['Spending', 'Spent', '$1,200.00', '37.5%'])
  expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Show chart' }))
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument()
})

test('the table lists what an account spent as a row to Spent', async () => {
  const [pay, account] = flow().nodes
  mockApi({
    payFlow: () =>
      flow({
        nodes: [pay!, { ...account!, caption: 'In $3,200.00 · spent $1,200.00 · kept $2,000.00', spentCents: 120_000 }],
        edges: [{ id: 'e1', from: 'pay:u1', to: 'account:a1', amountCents: 320_000 }],
      }),
  })
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))

  const rows = screen.getAllByRole('row').slice(1)
  expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
    ['Pay', 'Spending', '$3,200.00', '100%'],
    ['Spending', 'Spent', '$1,200.00', '37.5%'],
  ])
})

test('empty states', async () => {
  const empty = (state: PayFlowDto['state']) => () => flow({ state, cycle: null, nodes: [], edges: [] })

  mockApi({ payFlow: empty('needs-pay') })
  renderCard()
  expect(
    await screen.findByRole('link', { name: 'Set up your pay on Budgets to see where it goes ›' }),
  ).toHaveAttribute('href', '/budgets')
  cleanup()

  mockApi({ payFlow: empty('no-plan') })
  renderCard()
  expect(await screen.findByRole('link', { name: 'No plan for this pay yet ›' })).toHaveAttribute(
    'href',
    '/budgets',
  )
  cleanup()

  mockApi({ payFlow: empty('partner-not-connected') })
  renderCard('partner')
  expect(await screen.findByText("Your partner hasn't connected Up yet.")).toBeInTheDocument()
  cleanup()

  mockApi({ payFlow: empty('private'), partnerLevel: 'none' })
  renderCard('partner')
  expect(await screen.findByText("Sam doesn't share their personal accounts.")).toBeInTheDocument()
  cleanup()

  mockApi({ payFlow: () => flow({ nodes: [], edges: [] }) })
  renderCard()
  expect(await screen.findByText('Nothing moved in this pay cycle yet.')).toBeInTheDocument()
})

test('a planned view with nothing in it says the plan has no items for it', async () => {
  mockApi({ payFlow: (q) => (q.get('mode') === 'planned' ? flow({ nodes: [], edges: [] }) : flow()) })
  renderCard('joint')
  await screen.findByRole('button', { name: 'Pay' })
  await userEvent.click(screen.getByRole('button', { name: 'Planned' }))
  expect(await screen.findByText("No items in this pay's plan for this view.")).toBeInTheDocument()
  expect(screen.queryByText('Nothing moved in this pay cycle yet.')).not.toBeInTheDocument()
})

test('a failed load offers a retry', async () => {
  let fail = true
  mockApi({ payFlow: () => (fail ? Response.json({ error: 'Boom' }, { status: 500 }) : flow()) })
  renderCard()
  expect(await screen.findByText("Couldn't load where the pay went.")).toBeInTheDocument()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Pay' })).toBeInTheDocument()
})

test('over-allocated caption', async () => {
  mockApi({ payFlow: () => flow({ overAllocatedCents: 15_050 }) })
  renderCard()
  expect(await screen.findByText('Over-allocated by $150.50')).toBeInTheDocument()
})

test('reset only with a saved layout', async () => {
  mockApi()
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  expect(screen.queryByRole('button', { name: 'Reset layout' })).not.toBeInTheDocument()
  cleanup()

  mockApi({ positions: { 'pay:u1': { x: 0, y: 0 } } })
  renderCard()
  await userEvent.click(await screen.findByRole('button', { name: 'Reset layout' }))
  await waitFor(() =>
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: '/api/flow-layouts/me:actual:accounts' }),
    ),
  )
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset layout' })).not.toBeInTheDocument())
})

test('move saves', async () => {
  mockApi()
  renderCard()
  const pay = await screen.findByRole('button', { name: 'Pay' })
  const puts = () => calls.filter((c) => c.method === 'PUT')

  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Spending' }))
  await vi.advanceTimersByTimeAsync(300)
  fireEvent.click(pay)
  await vi.advanceTimersByTimeAsync(499)
  expect(puts()).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(puts()).toEqual([
    {
      method: 'PUT',
      path: '/api/flow-layouts/me:actual:accounts',
      body: {
        positions: expect.objectContaining({ 'pay:u1': { x: 10, y: 20 }, 'account:a1': { x: 10, y: 20 } }),
      },
    },
  ])
  // The full map: boxes that weren't moved keep their automatic spot.
  expect(Object.keys((puts()[0].body as { positions: object }).positions).sort()).toEqual([
    'account:a1',
    'pay:u1',
    'spent:a1',
  ])
  await vi.runOnlyPendingTimersAsync() // React Query's notify flush was scheduled on a fake timer
  vi.useRealTimers()
  expect(await screen.findByRole('button', { name: 'Reset layout' })).toBeInTheDocument()
})

test('a save keeps boxes saved from other cycles, unless that would pass the 300-box cap', async () => {
  const putKeys = async (positions: Record<string, { x: number; y: number }>) => {
    mockApi({ positions })
    renderCard()
    const pay = await screen.findByRole('button', { name: 'Pay' })
    vi.useFakeTimers()
    fireEvent.click(pay)
    await vi.advanceTimersByTimeAsync(500)
    const put = calls.find((c) => c.method === 'PUT')!
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    cleanup()
    return Object.keys((put.body as { positions: object }).positions).sort()
  }

  // A debt box that only shows in some cycles keeps its spot.
  expect(await putKeys({ 'pay:u1': { x: 0, y: 0 }, 'debt:gone': { x: 400, y: 80 } })).toEqual([
    'account:a1',
    'debt:gone',
    'pay:u1',
    'spent:a1',
  ])

  // Over the cap, only the boxes on screen are saved.
  const many = Object.fromEntries(Array.from({ length: 298 }, (_, i) => [`line:old${i}`, { x: 0, y: i }]))
  const keys = await putKeys(many)
  expect(keys).toEqual(['account:a1', 'pay:u1', 'spent:a1'])
  expect(keys.length).toBeLessThanOrEqual(300)
})

test('a failed save shows a toast', async () => {
  mockApi({ putStatus: 400 })
  renderCard()
  fireEvent.click(await screen.findByRole('button', { name: 'Pay' }))
  expect(await screen.findByText('Too many boxes', {}, { timeout: 2_000 })).toBeInTheDocument()
})

test('cycle steps', async () => {
  mockApi()
  renderCard()
  expect(await screen.findByText('14 Oct – today')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next cycle' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Previous cycle' }))
  await waitFor(() =>
    expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&date=2026-09-30'),
  )
  // The stepper stays put while the next cycle loads, so keyboard focus isn't lost.
  expect(screen.getByRole('button', { name: 'Previous cycle' })).toHaveFocus()
})

test('changing scope goes back to the current cycle', async () => {
  mockApi()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const card = (scope: Scope) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PayFlowCard scope={scope} />
      </ToastProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(card('me'))
  await userEvent.click(await screen.findByRole('button', { name: 'Previous cycle' }))
  await waitFor(() =>
    expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&date=2026-09-30'),
  )
  rerender(card('joint'))
  await waitFor(() => expect(paths()).toContain('/api/pay-flow?scope=joint&mode=actual&group=accounts'))
  expect(paths().filter((p) => p.startsWith('/api/pay-flow?scope=joint'))).toEqual([
    '/api/pay-flow?scope=joint&mode=actual&group=accounts',
  ])
  // And coming back doesn't return to the old cycle either.
  const before = calls.length
  rerender(card('me'))
  const flowsSince = () => paths().slice(before).filter((p) => p.startsWith('/api/pay-flow'))
  await waitFor(() => expect(flowsSince()).toHaveLength(1))
  expect(flowsSince()).toEqual(['/api/pay-flow?scope=me&mode=actual&group=accounts'])
})

test('a cycle with no plan can still be stepped past', async () => {
  mockApi({ payFlow: () => flow({ state: 'no-plan', nodes: [], edges: [] }) })
  renderCard()
  expect(await screen.findByRole('link', { name: 'No plan for this pay yet ›' })).toBeInTheDocument()
  expect(screen.getByText('14 Oct – today')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Previous cycle' }))
  await waitFor(() =>
    expect(paths()).toContain('/api/pay-flow?scope=me&mode=actual&group=accounts&date=2026-09-30'),
  )
})

test('lines take the mouse even though React Flow marks them inactive', () => {
  const onHover = vi.fn()
  const props = {
    id: 'e1',
    sourceX: 200,
    sourceY: 32,
    targetX: 320,
    targetY: 32,
    data: {
      amountCents: 320_000,
      pct: 100,
      color: 'var(--positive)',
      dots: 12,
      fromLabel: 'Pay',
      toLabel: 'Spending',
      dimmed: false,
      active: false,
      reducedMotion: true,
      onHover,
    },
  } as unknown as EdgeProps<StreamEdgeType>
  render(
    <ReactFlowProvider>
      <svg>
        <StreamEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  )
  const line = screen.getByRole('group', { name: 'Pay to Spending, $3,200.00 · 100%' })
  // React Flow's base.css gives `.react-flow__edge.inactive` pointer-events: none (no selection, no onEdgeClick).
  expect(line).toHaveAttribute('pointer-events', 'visibleStroke')
  fireEvent.mouseEnter(line)
  expect(onHover).toHaveBeenCalledWith('e1', true)
})

test('a box shows its caption beside its share of pay; a pay keeps its caption for the tooltip', () => {
  const box = (n: PayFlowDto['nodes'][number], pctLine: string) => {
    const props = {
      id: n.id,
      data: {
        node: n,
        pctLine,
        dimmed: false,
        active: false,
        onNudge: vi.fn(),
        onHover: vi.fn(),
        onOpen: vi.fn(),
      },
    } as unknown as NodeProps<FlowBoxNode>
    return (
      <ReactFlowProvider>
        <FlowBox {...props} />
      </ReactFlowProvider>
    )
  }
  const [pay, , spent] = flow().nodes
  const { rerender } = render(box(spent!, '37.5% of pay'))
  const spentBox = screen.getByRole('group', { name: 'Spent, $1,200.00, from Spending · 37.5% of pay' })
  expect(spentBox).toHaveTextContent('from Spending · 37.5% of pay')

  rerender(box(pay!, '100% of pay'))
  expect(screen.getByRole('group', { name: 'Pay, +$3,200.00, 100% of pay' })).not.toHaveTextContent(
    'Acme Pty',
  )
})

test('a pinned box shows a link to open it; a plain hover does not', async () => {
  const onOpen = vi.fn()
  const account = flow().nodes[1]!
  const box = (pinned: boolean, active: boolean) => {
    const props = {
      id: account.id,
      data: { node: account, pctLine: null, dimmed: false, active, pinned, onNudge: vi.fn(), onHover: vi.fn(), onOpen },
    } as unknown as NodeProps<FlowBoxNode>
    return (
      <ReactFlowProvider>
        <FlowBox {...props} />
      </ReactFlowProvider>
    )
  }
  const { rerender } = render(box(false, true))
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open account ›' })).not.toBeInTheDocument()

  rerender(box(true, false))
  await userEvent.click(screen.getByRole('button', { name: 'Open account ›' }))
  expect(onOpen).toHaveBeenCalledWith('/accounts/a1')
})

test('zoom buttons step in and out, and stop at the limits', async () => {
  const onIn = vi.fn()
  const onOut = vi.fn()
  const { rerender } = render(<ZoomButtons zoom={1} disabled={false} onIn={onIn} onOut={onOut} />)
  await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
  expect(onIn).toHaveBeenCalledTimes(1)
  expect(onOut).toHaveBeenCalledTimes(1)

  rerender(<ZoomButtons zoom={2} disabled={false} onIn={onIn} onOut={onOut} />)
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled()
  rerender(<ZoomButtons zoom={0.1} disabled={false} onIn={onIn} onOut={onOut} />)
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  rerender(<ZoomButtons zoom={1} disabled onIn={onIn} onOut={onOut} />)
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
})

test('the chart says how to zoom; the table does not', async () => {
  mockApi()
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  expect(screen.getByText('Ctrl + scroll or + / − to zoom · drag to pan')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled()

  await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))
  expect(screen.queryByText(/to zoom/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
})

test("a clicked box's info box shows its interest; hovering doesn't", () => {
  const account = { ...flow().nodes[1]!, interestCents: 175 }
  const box = (pinned: boolean, active: boolean) => {
    const props = {
      id: account.id,
      data: { node: account, pctLine: null, dimmed: false, active, pinned, onNudge: vi.fn(), onHover: vi.fn(), onOpen: vi.fn() },
    } as unknown as NodeProps<FlowBoxNode>
    return (
      <ReactFlowProvider>
        <FlowBox {...props} />
      </ReactFlowProvider>
    )
  }
  const { rerender } = render(box(false, true))
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('Interest')
  rerender(box(true, false))
  expect(screen.getByRole('tooltip')).toHaveTextContent('Interest $1.75')
})

test('the table lists interest as a row into the account', async () => {
  const [pay, account] = flow().nodes
  mockApi({
    payFlow: () =>
      flow({
        nodes: [pay!, { ...account!, interestCents: 175 }],
        edges: [{ id: 'e1', from: 'pay:u1', to: 'account:a1', amountCents: 320_000 }],
      }),
  })
  renderCard()
  await screen.findByRole('button', { name: 'Pay' })
  await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))
  const rows = screen.getAllByRole('row').slice(1)
  expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Interest', 'Spending', '$1.75', '0.1%'])
})
