import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Search } from 'lucide-react'
import { webApi } from '../lib/web-api'
import { buildModelStatsRows, type ModelStatsRow } from '../lib/model-stats'
import type { ArchivedRunResult } from '../types'
import { formatCurrency, formatDuration, formatFileSize, formatNumber } from '../utils/formatters'

type SortField = keyof Pick<ModelStatsRow,
  'providerName' | 'model' | 'documentCategory' | 'documentType' | 'runs' | 'successRate' |
  'averageTotalTokens' | 'averageCost' | 'averageLatencyMs' | 'averageFileSize' |
  'averageExtractedFeatureCount' | 'costPerExtractedFeature' | 'totalCost' | 'lastRunTimestamp'
>

export function ModelStatsTab() {
  const [records, setRecords] = useState<ArchivedRunResult[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [category, setCategory] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'lastRunTimestamp', dir: 'desc' })

  useEffect(() => {
    webApi.getArchivedResults(5000)
      .then(data => setRecords(data.records ?? []))
      .finally(() => setLoading(false))
  }, [])

  const rows = useMemo(() => buildModelStatsRows(records), [records])
  const providers = useMemo(() => unique(rows.map(row => row.providerName)), [rows])
  const models = useMemo(() => unique(rows.map(row => row.model)), [rows])
  const categories = useMemo(() => unique(rows.map(row => row.documentCategory)), [rows])
  const documentTypes = useMemo(() => unique(rows.map(row => row.documentType)), [rows])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(row => {
      if (provider && row.providerName !== provider) return false
      if (model && row.model !== model) return false
      if (category && row.documentCategory !== category) return false
      if (documentType && row.documentType !== documentType) return false
      if (!q) return true
      return [row.providerName, row.model, row.documentCategory, row.documentType].some(value => value.toLowerCase().includes(q))
    })
  }, [rows, query, provider, model, category, documentType])

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = a[sort.field]
      const bv = b[sort.field]
      let cmp = 0
      if (sort.field === 'costPerExtractedFeature') {
        if (av == null && bv == null) cmp = 0
        else if (av == null) cmp = 1
        else if (bv == null) cmp = -1
        else cmp = Number(av) - Number(bv)
      } else if (sort.field === 'lastRunTimestamp') {
        cmp = String(av).localeCompare(String(bv))
      } else if (typeof av === 'number' || typeof bv === 'number') {
        cmp = Number(av ?? 0) - Number(bv ?? 0)
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      }
      if (cmp === 0) cmp = a.providerName.localeCompare(b.providerName) || a.model.localeCompare(b.model)
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filteredRows, sort])

  const summary = useMemo(() => ({
    groupedRuns: filteredRows.reduce((sum, row) => sum + row.runs, 0),
    avgSuccess: filteredRows.length ? filteredRows.reduce((sum, row) => sum + row.successRate, 0) / filteredRows.length : 0,
    totalCost: filteredRows.reduce((sum, row) => sum + row.totalCost, 0),
  }), [filteredRows])

  function toggleSort(field: SortField) {
    setSort(current => ({ field, dir: current.field === field && current.dir === 'desc' ? 'asc' : 'desc' }))
  }

  function SortHeader({ field, children, className = '' }: { field: SortField; children: ReactNode; className?: string }) {
    const active = sort.field === field
    return (
      <th className={`px-3 py-2 font-medium ${className}`}>
        <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 hover:text-surface-200">
          {children}
          {active ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowDown size={12} className="opacity-0" />}
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-bold text-surface-100">Model Stats</h2>
        <p className="text-sm text-surface-400 mt-1">Archive-level model performance grouped by provider, model, category, and document type.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Grouped Runs" value={formatNumber(summary.groupedRuns)} />
        <Metric label="Avg Success" value={`${Math.round(summary.avgSuccess * 100)}%`} />
        <Metric label="Total Cost" value={formatCurrency(summary.totalCost)} />
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input className="input pl-9 text-sm" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search provider, model, category..." />
        </div>
        <Filter value={provider} onChange={setProvider} options={providers} label="All providers" />
        <Filter value={model} onChange={setModel} options={models} label="All models" />
        <Filter value={category} onChange={setCategory} options={categories} label="All categories" />
        <Filter value={documentType} onChange={setDocumentType} options={documentTypes} label="All document types" />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="max-h-[calc(100vh-290px)] overflow-auto">
          <table className="w-full min-w-[1320px] text-left text-xs">
            <thead className="sticky top-0 bg-surface-950 text-surface-400">
              <tr>
                <SortHeader field="providerName">Provider</SortHeader>
                <SortHeader field="model">Model</SortHeader>
                <SortHeader field="documentCategory">Category</SortHeader>
                <SortHeader field="documentType">Doc Type</SortHeader>
                <SortHeader field="runs" className="text-right">Runs</SortHeader>
                <SortHeader field="successRate" className="text-right">Success</SortHeader>
                <SortHeader field="averageTotalTokens" className="text-right">Avg Tokens</SortHeader>
                <SortHeader field="averageCost" className="text-right">Avg Cost</SortHeader>
                <SortHeader field="averageLatencyMs" className="text-right">Avg Latency</SortHeader>
                <SortHeader field="averageFileSize" className="text-right">Avg Size</SortHeader>
                <SortHeader field="averageExtractedFeatureCount" className="text-right">Avg Features</SortHeader>
                <SortHeader field="costPerExtractedFeature" className="text-right">Cost / Feature</SortHeader>
                <SortHeader field="totalCost" className="text-right">Total Cost</SortHeader>
                <SortHeader field="lastRunTimestamp">Last Run</SortHeader>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="px-4 py-8 text-center text-surface-500">Loading model stats...</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-8 text-center text-surface-500">No archive rows match the current filters.</td></tr>
              ) : sortedRows.map(row => (
                <tr key={row.key} className="border-t border-surface-800 text-surface-200">
                  <td className="px-3 py-2 font-mono">{row.providerName}</td>
                  <td className="px-3 py-2 font-mono">{row.model}</td>
                  <td className="px-3 py-2">{categoryLabel(row)}</td>
                  <td className="px-3 py-2">{row.documentType}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.runs}</td>
                  <td className="px-3 py-2 text-right font-mono">{Math.round(row.successRate * 100)}%</td>
                  <td className="px-3 py-2 text-right font-mono">{Math.round(row.averageTotalTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.averageCost)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatDuration(row.averageLatencyMs)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatFileSize(row.averageFileSize)}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.averageExtractedFeatureCount.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.costPerExtractedFeature == null ? '-' : formatCurrency(row.costPerExtractedFeature)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.totalCost)}</td>
                  <td className="px-3 py-2" title={row.lastRunTimestamp}>{relativeDay(row.lastRunTimestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3">
      <BarChart3 size={18} className="text-brand-gold" />
      <div>
        <div className="text-xs text-surface-500">{label}</div>
        <div className="text-lg font-semibold text-surface-100">{value}</div>
      </div>
    </div>
  )
}

function Filter({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select className="input min-w-40 text-sm" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort()
}

function categoryLabel(row: ModelStatsRow) {
  if (row.averageDocumentCategoryConfidence == null) return row.documentCategory
  return `${row.documentCategory} (${Math.round(row.averageDocumentCategoryConfidence * 100)}%)`
}

function relativeDay(value: string) {
  if (!value) return '-'
  const then = new Date(value)
  if (!Number.isFinite(then.getTime())) return '-'
  const now = new Date()
  const thenDay = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate())
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.max(0, Math.round((nowDay - thenDay) / 86400000))
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}
