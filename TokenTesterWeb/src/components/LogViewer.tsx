import { useState } from 'react'
import { ChevronRight, ChevronDown, Terminal, X, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import type { LogEntry } from '../store/log-slice'

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 1000) return 'now'
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`
  return `${Math.round(ms / 3600000)}h ago`
}

export function LogViewer() {
  const { logs, clearLogs } = useStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filtered = filter.trim()
    ? logs.filter(e => e.caller.toLowerCase().includes(filter.toLowerCase()) || e.url.toLowerCase().includes(filter.toLowerCase()) || String(e.status).includes(filter))
    : logs

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-surface-400" />
          <span className="text-sm font-medium text-surface-200">API Log ({logs.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input text-xs py-1 px-2 w-48"
            placeholder="Filter by caller, url, status..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {logs.length > 0 && (
            <button onClick={clearLogs} className="btn-danger flex items-center gap-1 py-1 px-2 text-xs">
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-xs text-surface-500 py-4 text-center">
          {logs.length === 0 ? 'No API calls logged yet. Run some tests to see logs here.' : 'No logs match the current filter.'}
        </div>
      ) : (
        <div className="space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
          {filtered.map(entry => (
            <LogEntryCard key={entry.id} entry={entry} expanded={expanded.has(entry.id)} onToggle={() => toggle(entry.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function LogEntryCard({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  const statusColor = !entry.status ? 'text-surface-400' : entry.status < 300 ? 'text-emerald-400' : entry.status < 500 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="card p-2 text-xs font-mono">
      <button onClick={onToggle} className="w-full flex items-center gap-2 text-left">
        {expanded ? <ChevronDown size={12} className="shrink-0 text-surface-500" /> : <ChevronRight size={12} className="shrink-0 text-surface-500" />}
        <span className="text-surface-500 w-16 shrink-0">{relativeTime(entry.timestamp)}</span>
        <span className={`${statusColor} w-8 shrink-0 text-right`}>{entry.status ?? '---'}</span>
        <span className="text-surface-300 w-32 shrink-0 truncate">{entry.caller}</span>
        <span className="text-surface-400 truncate">{entry.method} {entry.url.replace(/api[^/]*\.\w+\.\w+\//, '…/')}</span>
        {entry.durationMs != null && <span className="text-surface-500 w-16 shrink-0 text-right">{entry.durationMs}ms</span>}
        {entry.error && <span className="text-red-400 truncate ml-auto">{entry.error}</span>}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-surface-700 pt-2">
          <DetailRow label="Caller" value={entry.caller} />
          <DetailRow label="URL" value={`${entry.method} ${entry.url}`} />
          {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 && (
            <DetailRow label="Req Headers" value={JSON.stringify(entry.requestHeaders, null, 2)} mono />
          )}
          {entry.requestBody && <DetailRow label="Request Body" value={entry.requestBody} mono />}
          {entry.status != null && <DetailRow label="Status" value={String(entry.status)} />}
          {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 && (
            <DetailRow label="Resp Headers" value={JSON.stringify(entry.responseHeaders, null, 2)} mono />
          )}
          {entry.responseBody && <DetailRow label="Response Body" value={entry.responseBody} mono />}
          {entry.durationMs != null && <DetailRow label="Duration" value={`${entry.durationMs}ms`} />}
          {entry.error && <DetailRow label="Error" value={entry.error} />}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-surface-500 w-24 shrink-0">{label}</span>
      <span className={`text-surface-200 break-all ${mono ? 'font-mono text-[10px] whitespace-pre-wrap' : ''}`}>{value}</span>
    </div>
  )
}
