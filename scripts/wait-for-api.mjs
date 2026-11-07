// `pnpm dev` helper: hold Vite back until the API answers, so the first page load can't hit a dead proxy.
const port = process.env.PORT ?? '3000'
const url = `http://localhost:${port}/api/setup/status`
const deadline = Date.now() + 60_000

for (;;) {
  try {
    if ((await fetch(url)).ok) break
  } catch {
    // not listening yet
  }
  if (Date.now() > deadline) {
    console.error(`The API didn't start on port ${port} within 60s. Check the [server] output above.`)
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
}
