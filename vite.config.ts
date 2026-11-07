import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const web = path.resolve('src/web')

// Proxy to the API on the same PORT the server reads from .env. Only PORT is read, in case .env holds secrets.
function envPort(): string | undefined {
  try {
    return parseEnv(readFileSync('.env', 'utf8')).PORT
  } catch {
    return undefined
  }
}
const apiPort = process.env.PORT ?? envPort() ?? '3000'

export default defineConfig({
  root: web,
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: path.join(web, 'routes'),
      generatedRouteTree: path.join(web, 'routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  build: { outDir: path.resolve('dist/web'), emptyOutDir: true },
  server: {
    port: 5173,
    // Keep the browser's Host header: the server's CSRF guard compares it with Origin.
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
  },
})
