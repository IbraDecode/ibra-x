import type { Logger } from "@ibrax/sdk"

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
export type LogLevel = keyof typeof LEVELS

export interface CreateLoggerOptions {
  level?: LogLevel
  bindings?: Record<string, unknown>
  /** Bila true, keluarkan JSON per baris. Default false (ramah manusia). */
  json?: boolean
}

function serialize(obj: unknown): string {
  if (obj instanceof Error) return obj.stack ?? obj.message
  if (obj === undefined || obj === null) return ""
  if (typeof obj === "object") {
    try {
      return JSON.stringify(obj)
    } catch {
      return String(obj)
    }
  }
  return String(obj)
}

/**
 * Logger kecil tanpa dependensi eksternal. Menulis ke stdout/stderr dengan
 * level dan bindings. Dirancang agar instalasi tidak menambah paket native.
 */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const minLevel = LEVELS[opts.level ?? "info"]
  const base = opts.bindings ?? {}
  const json = opts.json ?? false

  const log = (level: LogLevel, bindings: Record<string, unknown>, obj?: unknown, msg?: string) => {
    if (LEVELS[level] < minLevel) return
    const ts = new Date().toISOString()
    if (json) {
      process.stdout.write(
        JSON.stringify({ ts, level, ...base, ...bindings, msg: msg ?? (typeof obj === "string" ? obj : undefined), data: typeof obj === "string" ? undefined : obj }) +
          "\n",
      )
      return
    }
    const prefix = `${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)}`
    const scope = Object.entries(bindings)
      .map(([k, v]) => `${k}=${serialize(v)}`)
      .join(" ")
    const detail = typeof obj === "string" ? obj : serialize(obj)
    const line = [prefix, scope, msg, detail].filter(Boolean).join(" ")
    ;(level === "error" ? process.stderr : process.stdout).write(line + "\n")
  }

  const make = (bindings: Record<string, unknown>): Logger => ({
    debug: (obj, msg) => log("debug", bindings, obj, msg),
    info: (obj, msg) => log("info", bindings, obj, msg),
    warn: (obj, msg) => log("warn", bindings, obj, msg),
    error: (obj, msg) => log("error", bindings, obj, msg),
    child: (extra) => make({ ...bindings, ...extra }),
  })

  return make(base)
}
