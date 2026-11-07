# Upkeep

A self-hosted finance tracker for a two-person household, built on the [Up Banking API](https://developer.up.com.au/). It keeps both people's accounts, spending, budgets, savings and debts in one place, under your control.

Upkeep isn't affiliated with or endorsed by Up. It only works with Up accounts, and you need an Up personal access token for each person.

## What it does

- **Overview:** income and spending, and a chart of where each pay went.
- **Accounts and transactions:** personal and 2Up joint accounts, with search and filters. Changes to categories and tags are written back to Up.
- **Budgets:** follow your pay cycle rather than calendar months. Mark your pay once, set spending limits on Up categories, and plan what goes to each Saver. The plan ticks itself off as your money moves.
- **Goals:** savings targets linked to Up Savers.
- **Debts:** manual debts with interest, repayments and payoff projections, including importing an ATO HELP statement.
- **Net worth:** your history over time.
- **Sharing:** each person chooses how much of their personal money the other can see. Joint accounts are always shared.

## Requirements

- Node.js 24+
- pnpm 10 (`npm install -g pnpm`)
- An Up personal access token ([api.up.com.au](https://api.up.com.au)). Generating a new token stops the previous one from working.

## Running it

```bash
pnpm install
cp .env.example .env      # optional: adjust port, timezone, sync interval
pnpm build                # web app → dist/web, server → dist/server
pnpm start                # one process serves both on PORT (default 3000)
```

Open http://localhost:3000, then:

1. Create your login and choose what your partner can see.
2. Paste your Up token. Upkeep checks it with Up, stores it encrypted and imports your full history.
3. Follow the **Getting started** list on the Overview page to add your partner, set up your pay and budget, and optionally add debts and goals. Your partner logs in with their own account and connects their own token. Shared 2Up transactions are stored once.

After the first import, Upkeep polls Up every 5 minutes and re-checks the last 30 days nightly, which catches pending transactions settling and deleted holds. It only syncs while it's running, and catches up when it next starts.

**Keep it private.** The server speaks plain HTTP and listens on all network interfaces. Run it on a trusted network or behind a private overlay such as [Tailscale](https://tailscale.com), and don't expose it directly to the internet.

## Running it with Docker

You only need Docker with the Compose plugin, not Node or pnpm.

```bash
git clone https://github.com/olandmine/upkeep.git
cd upkeep
```

If you're outside Sydney's timezone, create a `.env` file in the `upkeep` folder containing your own, such as `TZ=Australia/Perth`. Day and pay-period boundaries depend on it.

Then build and start it. The first build can take several minutes, and it restarts by itself after a reboot.

```bash
docker compose up -d --build
```

Open http://localhost:3000 and follow the steps under [Running it](#running-it) from "Create your login".

**Reaching it from other devices:** the container only accepts connections from the machine it runs on. To use it from your phones, put a private overlay in front of it. With [Tailscale](https://tailscale.com), enable MagicDNS and HTTPS certificates in the admin console, then run:

```bash
sudo tailscale serve --bg 3000
```

Upkeep is then at `https://<machine-name>.<your-tailnet>.ts.net` for devices on your tailnet. Certificate names are publicly logged, so your tailnet name becomes public. You can change it to something less personal first.

**Updating:**

```bash
git pull
docker compose up -d --build
```

Database migrations run on start. Going back to an older commit doesn't undo them.

> **Warning:** `docker compose down -v` permanently deletes your database and encryption key. `docker compose down` on its own is safe.

**Backups:** your data is in the Docker volume `upkeep_upkeep-data`. See [Data and privacy](#data-and-privacy).

## Configuration (`.env`)

| Variable                | Default             | Purpose                                                                                 |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`              | HTTP port                                                                               |
| `DATA_DIR`              | `./data`            | SQLite database and encryption key                                                      |
| `UPKEEP_SECRET_KEY`     | _(generated)_       | 32-byte base64 key that encrypts Up tokens. If unset, `DATA_DIR/secret.key` is created. |
| `TZ`                    | system timezone     | Day and month boundaries, e.g. `Australia/Sydney`                                       |
| `SYNC_INTERVAL_MINUTES` | `5`                 | Polling interval                                                                        |
| `RECONCILE_HOUR`        | `3`                 | Local hour of the nightly 30-day re-check                                               |
| `UP_API_BASE_URL`       | Up's production API | Overridden by the tests                                                                 |

## Data and privacy

- Everything lives in `DATA_DIR`: `upkeep.db` (SQLite) and `secret.key`. Upkeep's only outside connection is to Up.
- Up tokens are encrypted at rest with AES-256-GCM and never sent back to the browser. Transaction data isn't encrypted, so whoever runs the server can read `upkeep.db`.
- **Sharing levels:** **Full transparency**, **Hide transactions** (accounts, totals, budgets, goals and debts stay visible), **Balances only** or **No sharing**. The server enforces the choice, so a hidden item can't be reached by changing a URL.
- **Backups:** copy `upkeep.db` regularly, and store `secret.key` (or `UPKEEP_SECRET_KEY`) separately from those copies. Stop Upkeep before copying, because while it's running recent changes may be only in `upkeep.db-wal`, and the copy could be incomplete. Budgets, goals and debts exist only in the database. Transactions can be re-synced from Up, and losing the key only means re-pasting tokens.

## Development

```bash
pnpm dev                  # API on :3000, web app on http://localhost:5173
```

| Script                         | What it does                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm dev`                     | Server (tsx watch) plus the Vite dev server, which proxies `/api` |
| `pnpm build` / `pnpm start`    | Production build, and running it                                  |
| `pnpm test`                    | Unit, integration and component tests (Vitest)                    |
| `pnpm test:e2e`                | End-to-end flows in Chrome against a fake Up API (Playwright)     |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint                                             |
| `pnpm db:generate`             | Generate a migration after changing `src/server/db/schema.ts`     |

Built with TypeScript, Hono, SQLite (Drizzle), React, TanStack Router and Query, and Tailwind.

## Licence

[GPL-3.0](LICENSE)
