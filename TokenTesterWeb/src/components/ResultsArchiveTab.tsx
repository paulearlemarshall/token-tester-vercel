import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowDown, ArrowUp, BarChart3, Database, RefreshCw, Search, Table2 } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { webApi } from '../lib/web-api'
import type { ArchivedRunResult } from '../types'
import { formatCurrency, formatDuration, formatNumber } from '../utils/formatters'

type SortField = 'completedAt' | 'providerName' | 'model' | 'status' | 'sourceType' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'estimatedCost' | 'fileName'

const COLORS = ['#f5c84c', '#57a6ff', '#37c391', '#f97316', '#a78bfa', '#ef4444', '#14b8a6', '#ec4899']

export function ResultsArchiveTab() {
  const [records, setRecords] = useState<ArchivedRunResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [view, setView] = useState<'table' | 'charts'>('charts')
  const [sortField, setSortField] = useState<SortField>('completedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function loadArchive() {
    setLoading(true)
    setError(null)
    try {
      const data = await webApi.getArchivedResults(2000)
      setRecords(data.records ?? [])
    } catch (err: any) {
      setError(err.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    webApi.getArchivedResults(2000)
      .then(data => {
        if (!cancelled) setRecords(data.records ?? [])
      })
      .catch(err => {
        if (!cancelled) setError(err.message ?? String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const providers = useMemo(() => [...new Set(records.map(r => r.providerName).filter(Boolean))].sort(), [records])
  const models = useMemo(() => [...new Set(records.map(r => r.model).filter(Boolean))].sort(), [records])
  const statuses = useMemo(() => [...new Set(records.map(r => r.status).filter(Boolean))].sort(), [records])
  const sourceTypes = useMemo(() => [...new Set(records.map(r => r.sourceType).filter(Boolean))].sort(), [records])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records.filter(record => {
      if (provider && record.providerName !== provider) return false
      if (model && record.model !== model) return false
      if (status && record.status !== status) return false
      if (sourceType && record.sourceType !== sourceType) return false
      if (!q) return true
      const haystack = [
        record.providerName,
        record.serviceProvider,
        record.model,
        record.status,
        record.sourceType,
        record.sourceLabel,
        record.fileName,
        record.filePath,
        record.fileHash,
        record.inputHash,
        record.userMessageHash,
        record.responseText,
        record.error,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [records, query, provider, model, status, sourceType])

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'completedAt': cmp = new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(); break
        case 'providerName': cmp = a.providerName.localeCompare(b.providerName); break
        case 'model': cmp = a.model.localeCompare(b.model); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'sourceType': cmp = a.sourceType.localeCompare(b.sourceType); break
        case 'fileName': cmp = (a.fileName ?? '').localeCompare(b.fileName ?? ''); break
        case 'inputTokens': cmp = a.inputTokens - b.inputTokens; break
        case 'outputTokens': cmp = a.outputTokens - b.outputTokens; break
        case 'latencyMs': cmp = a.latencyMs - b.latencyMs; break
        case 'estimatedCost': cmp = (a.estimatedCost ?? 0) - (b.estimatedCost ?? 0); break
      }
      return cmp * sign
    })
  }, [filtered, sortField, sortDir])

  const summary = useMemo(() => {
    const successes = filtered.filter(r => r.status === 'success')
    const totalCost = filtered.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0)
    const avgLatency = successes.length
      ? successes.reduce((sum, r) => sum + r.latencyMs, 0) / successes.length
      : 0
    return {
      runs: filtered.length,
      successes: successes.length,
      errors: filtered.filter(r => r.status === 'error').length,
      skipped: filtered.filter(r => r.status === 'skipped').length,
      tokens: filtered.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost,
      avgLatency,
    }
  }, [filtered])

  const byModel = useMemo(() => groupRecords(filtered, r => r.model).slice(0, 12), [filtered])
  const byProvider = useMemo(() => groupRecords(filtered, r => r.providerName).slice(0, 12), [filtered])
  const byStatus = useMemo(() => groupRecords(filtered, r => r.status), [filtered])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(dir => dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function SortHeader({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) {
    const active = sortField === field
    return (
      <th onClick={() => toggleSort(field)} className={`cursor-pointer select-none px-4 py-2 text-left text-xs font-medium text-surface-400 ${className ?? ''}`}>
        <span className="inline-flex items-center gap-1">
          {children}
          {active ? (sortDir === 'asc' ? <ArrowUp size={11} className="text-brand-gold" /> : <ArrowDown size={11} className="text-brand-gold" />) : null}
        </span>
      </th>
    )
  }

  return (
    <div className="h-full flex flex-col p-6 gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-surface-100 flex items-center gap-2">
            <Archive size={22} className="text-brand-gold" /> Results Archive
          </h2>
          <p className="text-sm text-surface-400 mt-1">Persisted run history with prompt/file hashes, model usage, output, latency, and cost.</p>
        </div>
        <button onClick={loadArchive} disabled={loading} className="btn-secondary flex items-center gap-1.5">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-7 gap-3">
        <Metric label="Runs" value={formatNumber(summary.runs)} />
        <Metric label="Success" value={formatNumber(summary.successes)} />
        <Metric label="Errors" value={formatNumber(summary.errors)} />
        <Metric label="Skipped" value={formatNumber(summary.skipped)} />
        <Metric label="Tokens" value={formatNumber(summary.tokens)} />
        <Metric label="Cost" value={formatCurrency(summary.totalCost)} />
        <Metric label="Avg Latency" value={formatDuration(summary.avgLatency)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 p-3">
        <div className="relative min-w-72 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Smart filter: model, provider, file, hash, output, error..."
            className="input w-full pl-9"
          />
        </div>
        <FilterSelect value={provider} onChange={setProvider} options={providers} label="All providers" />
        <FilterSelect value={model} onChange={setModel} options={models} label="All models" />
        <FilterSelect value={status} onChange={setStatus} options={statuses} label="All statuses" />
        <FilterSelect value={sourceType} onChange={setSourceType} options={sourceTypes} label="All sources" />
        <div className="ml-auto flex rounded-lg border border-surface-700 bg-surface-850 p-1">
          <button onClick={() => setView('charts')} className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${view === 'charts' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>
            <BarChart3 size={14} /> Charts
          </button>
          <button onClick={() => setView('table')} className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${view === 'table' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>
            <Table2 size={14} /> Table
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      {view === 'charts' ? (
        <div className="grid flex-1 min-h-0 grid-cols-2 gap-4">
          <ChartPanel title="Cost by Model" data={byModel} metric="cost" />
          <ChartPanel title="Average Latency by Model" data={byModel} metric="avgLatency" />
          <ChartPanel title="Tokens by Provider" data={byProvider} metric="tokens" />
          <ChartPanel title="Runs by Status" data={byStatus} metric="runs" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-surface-700">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-900 border-b border-surface-700">
              <tr>
                <SortHeader field="completedAt">Completed</SortHeader>
                <SortHeader field="providerName">Provider</SortHeader>
                <SortHeader field="model">Model</SortHeader>
                <SortHeader field="status">Status</SortHeader>
                <SortHeader field="sourceType">Source</SortHeader>
                <SortHeader field="fileName">File</SortHeader>
                <th className="px-4 py-2 text-left text-xs font-medium text-surface-400">Input Hash</th>
                <SortHeader field="inputTokens" className="text-right">In</SortHeader>
                <SortHeader field="outputTokens" className="text-right">Out</SortHeader>
                <SortHeader field="latencyMs" className="text-right">Latency</SortHeader>
                <SortHeader field="estimatedCost" className="text-right">Cost</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sorted.map(record => (
                <tr key={record.id} className="border-b border-surface-800 hover:bg-surface-850">
                  <td className="px-4 py-2 text-xs text-surface-400 whitespace-nowrap">{new Date(record.completedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-surface-200">{record.providerName}</td>
                  <td className="px-4 py-2 font-mono text-xs text-surface-200">{record.model}</td>
                  <td className="px-4 py-2"><StatusBadge status={record.status} /></td>
                  <td className="px-4 py-2 text-surface-300">{record.sourceType}</td>
                  <td className="px-4 py-2 text-surface-300" title={record.filePath ?? undefined}>{record.fileName ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-surface-500" title={record.inputHash}>{record.inputHash.slice(0, 12)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(record.inputTokens)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(record.outputTokens)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatDuration(record.latencyMs)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(record.estimatedCost ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div className="flex h-56 items-center justify-center text-sm text-surface-500">
              <Database size={18} className="mr-2" /> No archived results match the current filters.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-surface-500">{label}</div>
      <div className="mt-1 truncate font-mono text-sm text-surface-100">{value}</div>
    </div>
  )
}

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input min-w-40">
      <option value="">{label}</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'success'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    : status === 'error'
      ? 'border-red-400/30 bg-red-400/10 text-red-300'
      : 'border-surface-500/30 bg-surface-700 text-surface-300'
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${cls}`}>{status}</span>
}

function ChartPanel({ title, data, metric }: { title: string; data: any[]; metric: 'cost' | 'avgLatency' | 'tokens' | 'runs' }) {
  return (
    <div className="min-h-0 rounded-lg border border-surface-700 bg-surface-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-surface-200">{title}</h3>
      <ResponsiveContainer width="100%" height="88%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={70} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 8 }} />
          <Legend />
          <Bar dataKey={metric} fill={COLORS[0]} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function groupRecords(records: ArchivedRunResult[], keyFn: (record: ArchivedRunResult) => string) {
  const map = new Map<string, { name: string; runs: number; cost: number; tokens: number; latencyTotal: number; latencyCount: number }>()
  for (const record of records) {
    const name = keyFn(record) || 'Unknown'
    const entry = map.get(name) ?? { name, runs: 0, cost: 0, tokens: 0, latencyTotal: 0, latencyCount: 0 }
    entry.runs += 1
    entry.cost += record.estimatedCost ?? 0
    entry.tokens += record.totalTokens
    if (record.status === 'success' && record.latencyMs > 0) {
      entry.latencyTotal += record.latencyMs
      entry.latencyCount += 1
    }
    map.set(name, entry)
  }
  return Array.from(map.values())
    .map(entry => ({
      name: entry.name.length > 32 ? `${entry.name.slice(0, 29)}...` : entry.name,
      runs: entry.runs,
      cost: Number(entry.cost.toFixed(6)),
      tokens: entry.tokens,
      avgLatency: entry.latencyCount ? Math.round(entry.latencyTotal / entry.latencyCount) : 0,
    }))
    .sort((a, b) => b.runs - a.runs)
}
