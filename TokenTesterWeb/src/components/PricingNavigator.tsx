import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Database, RefreshCw, Search, X } from 'lucide-react'
import { webApi } from '../lib/web-api'
import { useStore } from '../store'
import { formatCurrency } from '../utils/formatters'

interface PriceRecord {
  id?: number
  key: string
  serviceProvider: string
  modelId: string
  upstreamProvider: string | null
  displayName: string | null
  input: number
  output: number
  source: string
  sourcePriority: number
  sourceUrl: string | null
  sourceUpdatedAt: string | null
  rawSourcePayload: unknown
  rawProviderPayload: unknown
  matchStatus: string
  matchConfidence: number | null
  matchMethod: string | null
  matchEvidence: unknown
  updatedAt: string
  lastSeenAt: string
}

interface PriceGroup {
  key: string
  provider: string
  model: string
  effective: PriceRecord | null
  records: PriceRecord[]
}

type SortField = 'provider' | 'model' | 'input' | 'output' | 'winner' | 'records' | 'updated'
type SortDir = 'asc' | 'desc'

export function PricingNavigator({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<PriceGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [matchFilter, setMatchFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('provider')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await webApi.getPricingRecords()
      setGroups(data.records ?? [])
    } catch (err: any) {
      setError(err.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadRecords()
    }, 0)
    return () => window.clearTimeout(id)
  }, [loadRecords])

  const sources = useMemo(() => {
    const set = new Set<string>()
    groups.forEach(group => group.records.forEach(record => set.add(record.source)))
    return Array.from(set).sort()
  }, [groups])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups.filter(group => {
      const matchesQuery = !q || group.key.toLowerCase().includes(q) || (group.effective?.displayName ?? '').toLowerCase().includes(q)
      const matchesSource = !source || group.records.some(record => record.source === source)
      const matchesMatch = !matchFilter || group.records.some(record => record.matchStatus === matchFilter)
      return matchesQuery && matchesSource && matchesMatch
    })
  }, [groups, matchFilter, query, source])

  const matchStatuses = useMemo(() => {
    const set = new Set<string>()
    groups.forEach(group => group.records.forEach(record => set.add(record.matchStatus)))
    return Array.from(set).sort()
  }, [groups])

  const sortedFiltered = useMemo(() => {
    const filteredGroups = filtered.slice()
    const direction = sortDir === 'asc' ? 1 : -1
    filteredGroups.sort((a, b) => {
      const effectiveA = a.effective
      const effectiveB = b.effective
      let cmp = 0

      switch (sortField) {
        case 'provider':
          cmp = a.provider.localeCompare(b.provider)
          break
        case 'model':
          cmp = a.model.localeCompare(b.model)
          break
        case 'input':
          cmp = (effectiveA?.input ?? -1) - (effectiveB?.input ?? -1)
          break
        case 'output':
          cmp = (effectiveA?.output ?? -1) - (effectiveB?.output ?? -1)
          break
        case 'winner':
          cmp = (effectiveA?.source ?? '').localeCompare(effectiveB?.source ?? '')
          if (cmp === 0) cmp = (effectiveA?.sourcePriority ?? -1) - (effectiveB?.sourcePriority ?? -1)
          break
        case 'records':
          cmp = a.records.length - b.records.length
          break
        case 'updated':
          cmp = new Date(effectiveA?.updatedAt ?? 0).getTime() - new Date(effectiveB?.updatedAt ?? 0).getTime()
          break
      }

      if (cmp === 0) {
        cmp = a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)
      }
      return cmp * direction
    })
    return filteredGroups
  }, [filtered, sortDir, sortField])

  const refreshEffectivePricing = useCallback(async () => {
    const pricing = await webApi.getPricing()
    useStore.getState().loadBuiltinPricing(pricing)
  }, [])

  const deleteRecord = useCallback(async (record: PriceRecord) => {
    const label = `${sourceLabel(record.source)} price for ${record.serviceProvider}/${record.modelId}`
    const confirmed = window.confirm(`Delete ${label}?\n\nThe price can be repopulated later by provider discovery, llm-prices import, another imported source, or a manual override.`)
    if (!confirmed) return

    const key = `${record.key}:${record.source}:${record.id ?? 'legacy'}`
    setDeletingKey(key)
    setError('')
    try {
      const result = await webApi.deletePricing({
        id: record.id,
        serviceProvider: record.serviceProvider,
        modelId: record.modelId,
        source: record.source,
      })
      useStore.getState().removeModelPricing(result.keys?.length ? result.keys : [record.key])
      await refreshEffectivePricing()
      await loadRecords()
    } catch (err: any) {
      setError(err.message ?? String(err))
    } finally {
      setDeletingKey(null)
    }
  }, [loadRecords, refreshEffectivePricing])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(current => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortField(field)
    setSortDir('asc')
  }

  function SortHeader({ field, children, className }: { field: SortField; children: ReactNode; className?: string }) {
    const active = sortField === field
    return (
      <th className={`px-4 py-2 font-medium ${className ?? ''}`}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className="inline-flex items-center gap-1 text-left text-surface-400 hover:text-surface-100"
        >
          <span>{children}</span>
          {active ? (
            sortDir === 'asc'
              ? <ArrowUp size={10} className="text-brand-gold" />
              : <ArrowDown size={10} className="text-brand-gold" />
          ) : (
            <span className="text-surface-600">↕</span>
          )}
        </button>
      </th>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-surface-700 bg-surface-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-surface-700 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-surface-100">
              <Database size={18} className="text-brand-gold" />
              Pricing Navigator
            </h3>
            <p className="mt-1 text-xs text-surface-400">Effective prices, source precedence, raw context, and match evidence.</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-100" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-surface-700 px-5 py-3">
          <div className="relative min-w-64 flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
            <input className="input py-1.5 pl-8 text-xs" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search provider/model..." />
          </div>
          <select className="input w-44 py-1.5 text-xs" value={source} onChange={e => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map(item => <option key={item} value={item}>{sourceLabel(item)}</option>)}
          </select>
          <select className="input w-44 py-1.5 text-xs" value={matchFilter} onChange={e => setMatchFilter(e.target.value)}>
            <option value="">All matches</option>
            {matchStatuses.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <button onClick={loadRecords} disabled={loading} className="btn-secondary flex items-center gap-1.5 py-1.5 text-xs">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && <div className="border-b border-red-900/50 bg-red-950/20 px-5 py-2 text-xs text-red-300">{error}</div>}

        <div className="overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-900 text-surface-400">
              <tr>
                <SortHeader field="provider">Provider</SortHeader>
                <SortHeader field="model">Model</SortHeader>
                <SortHeader field="input" className="text-right">Input</SortHeader>
                <SortHeader field="output" className="text-right">Output</SortHeader>
                <SortHeader field="winner">Winner</SortHeader>
                <SortHeader field="records" className="text-right">Records</SortHeader>
                <SortHeader field="updated">Updated</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(group => {
                const effective = group.effective
                const isExpanded = expanded === group.key
                return (
                  <Fragment key={group.key}>
                    <tr key={group.key} className="border-t border-surface-800 hover:bg-surface-900/70">
                      <td className="px-4 py-2 align-top">
                        <button onClick={() => setExpanded(isExpanded ? null : group.key)} className="flex items-center gap-2 text-left">
                          <ChevronDown size={13} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          <span className="font-mono text-surface-100">{group.provider}</span>
                        </button>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="max-w-md">
                          <div className="font-mono text-surface-100">{group.model}</div>
                          {effective?.displayName && <div className="text-surface-500">{effective.displayName}</div>}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-right text-surface-200">
                        {effective ? formatCurrency(effective.input) : '-'}
                      </td>
                      <td className="px-4 py-2 font-mono text-right text-surface-200">
                        {effective ? formatCurrency(effective.output) : '-'}
                      </td>
                      <td className="px-4 py-2">
                        {effective ? (
                          <span className="rounded-full border border-brand-gold/40 bg-brand-gold/10 px-2 py-0.5 text-[10px] font-semibold text-brand-charcoal dark:text-brand-gold">
                            {sourceLabel(effective.source)} p{effective.sourcePriority}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-2 text-right text-surface-300">{group.records.length}</td>
                      <td className="px-4 py-2 text-surface-400">{effective ? new Date(effective.updatedAt).toLocaleString() : '-'}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-surface-800 bg-surface-950">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-3">
                            {group.records.map(record => (
                              <div key={`${record.key}-${record.source}`} className="rounded-lg border border-surface-800 bg-surface-900 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="font-mono text-xs text-surface-100">{sourceLabel(record.source)} · priority {record.sourcePriority}</div>
                                    <div className="mt-0.5 text-[10px] text-surface-500">{record.matchStatus} · {record.matchMethod ?? 'unknown'} · confidence {record.matchConfidence ?? '-'}</div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => deleteRecord(record)}
                                    disabled={deletingKey === `${record.key}:${record.source}:${record.id ?? 'legacy'}`}
                                    className="rounded-md border border-red-900/60 bg-red-950/30 p-1 text-red-300 hover:border-red-700 hover:bg-red-950/50 disabled:cursor-wait disabled:opacity-50"
                                    title="Delete this price source"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-surface-300 md:grid-cols-4">
                                  <div>Input: <span className="font-mono">{formatCurrency(record.input)}</span></div>
                                  <div>Output: <span className="font-mono">{formatCurrency(record.output)}</span></div>
                                  <div>Upstream: <span className="font-mono">{record.upstreamProvider ?? '-'}</span></div>
                                  <div>Seen: <span className="font-mono">{new Date(record.lastSeenAt).toLocaleString()}</span></div>
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                  <JsonDetails title="Match Evidence" value={record.matchEvidence} />
                                  <JsonDetails title="Source Payload" value={record.rawSourcePayload} />
                                  <JsonDetails title="Provider Payload" value={record.rawProviderPayload} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-surface-500">
              {loading ? 'Loading pricing records...' : 'No pricing records match the current filters.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function sourceLabel(source: string) {
  switch (source) {
    case 'provider-discovery':
      return 'Provider discovery'
    case 'manual':
      return 'Manual override'
    case 'llm-prices':
      return 'llm-prices'
    case 'seed_json':
      return 'Imported JSON (legacy)'
    case 'imported-json':
      return 'Imported JSON'
    default:
      return source
  }
}

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  const empty = value == null
  return (
    <details className="rounded-md border border-surface-800 bg-surface-950 p-2">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-surface-400">{title}</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-surface-300">
        {empty ? 'null' : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}
