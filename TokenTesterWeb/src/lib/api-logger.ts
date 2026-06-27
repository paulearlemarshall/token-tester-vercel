import { AsyncLocalStorage } from 'async_hooks'

const BASE64_RE = /"data:[^;]+;base64,[^"]+"/g
const BASE64_RE2 = /data:[^;]+;base64,[^\s)\]]+/g

function truncate(val: unknown, maxLen = 2000): string {
  let s = typeof val === 'string' ? val : JSON.stringify(val)
  s = s.replace(BASE64_RE, (m) => `"[BASE64_${Math.round((m.length - m.indexOf(',')) * 0.75)}]"`)
  s = s.replace(BASE64_RE2, (m) => `[BASE64_${Math.round((m.length - m.indexOf(',')) * 0.75)}]`)
  if (s.length > maxLen) s = s.slice(0, maxLen) + `... [truncated ${s.length - maxLen} more chars]`
  return s
}

export interface LogEntry {
  id: string
  timestamp: string
  caller: string
  method: string
  url: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  status?: number
  responseHeaders?: Record<string, string>
  responseBody?: string
  durationMs?: number
  error?: string
}

let logIdCounter = 0

export async function loggedFetch(
  caller: string,
  url: string,
  options: RequestInit,
  logAccum: LogEntry[],
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const id = `log_${++logIdCounter}_${Date.now()}`
  const timestamp = new Date().toISOString()
  const method = (options.method ?? 'GET').toUpperCase()
  const requestHeaders: Record<string, string> = {}
  if (options.headers instanceof Headers) {
    options.headers.forEach((v, k) => { requestHeaders[k] = v })
  } else if (Array.isArray(options.headers)) {
    for (const [k, v] of options.headers) requestHeaders[k] = v
  } else if (options.headers) {
    Object.assign(requestHeaders, options.headers)
  }

  const entry: LogEntry = {
    id, timestamp, caller, method, url,
    requestHeaders,
    requestBody: options.body ? truncate(options.body) : undefined,
  }
  logAccum.push(entry)

  const start = performance.now()
  try {
    const res = await fetchImpl(url, options)
    entry.durationMs = Math.round(performance.now() - start)
    entry.status = res.status
    const cloned = res.clone()
    const text = await cloned.text()
    entry.responseBody = truncate(text)
    entry.responseHeaders = Object.fromEntries(res.headers.entries())
    return res
  } catch (err: any) {
    entry.durationMs = Math.round(performance.now() - start)
    entry.error = err?.message ?? String(err)
    throw err
  }
}

const logStorage = new AsyncLocalStorage<{ logs: LogEntry[]; caller: string }>()

const originalFetch = globalThis.fetch
globalThis.fetch = function fetchWithLogging(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const ctx = logStorage.getStore()
  if (!ctx) return originalFetch(url, options)
  return loggedFetch(ctx.caller, String(url), options ?? {}, ctx.logs, originalFetch)
} as typeof fetch

export function runWithLogging<T>(caller: string, fn: () => Promise<T>): Promise<{ result: T; logs: LogEntry[] }> {
  const logs: LogEntry[] = []
  return logStorage.run({ logs, caller }, async () => {
    const result = await fn()
    return { result, logs }
  })
}
