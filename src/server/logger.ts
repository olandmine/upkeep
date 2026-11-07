export interface Logger {
  info(msg: string, fields?: object): void
  warn(msg: string, fields?: object): void
  error(msg: string, fields?: object): void
}

const SECRET_KEY = /token|authorization|cookie|password|secret/i

function redact(fields: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k)) out[k] = '[redacted]'
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message }
    else out[k] = v
  }
  return out
}

export function createLogger(opts: { write?: (line: string) => void } = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'))
  const log = (level: string) => (msg: string, fields: object = {}) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...redact(fields) }))
  return { info: log('info'), warn: log('warn'), error: log('error') }
}
