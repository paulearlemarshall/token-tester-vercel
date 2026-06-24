import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Archive, ArrowDown, ArrowUp, BarChart3, Database, EyeOff, RefreshCw, RotateCcw, Search, Table2, Trash2, X } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import { webApi } from '../lib/web-api'
import type { ArchivedRunResult } from '../types'
import { formatCurrency, formatDuration, formatFileSize, formatNumber } from '../utils/formatters'

type SortField = 'completedAt' | 'createdAt' | 'providerName' | 'model' | 'status' | 'sourceType' | 'fileName' | 'prompt' | 'inputHash' | 'pdfSent' | 'pdfFileSize' | 'imageSent' | 'imageFileSize' | 'videoSent' | 'videoFileSize' | 'audioSent' | 'audioFileSize' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'estimatedCost' | 'suppressed'

const COLORS = ['#f5c84c', '#57a6ff', '#37c391', '#f97316', '#a78bfa', '#ef4444', '#14b8a6', '#ec4899']

const RECORD_COLUMNS: { id: SortField; label: string; cellClassName?: string; cell: (record: ArchivedRunResult) => ReactNode }[] = [
  { id: 'completedAt', label: 'Completed', cellClassName: 'text-xs text-surface-400 whitespace-nowrap', cell: record => new Date(record.completedAt).toLocaleString() },
  { id: 'createdAt', label: 'Archived', cellClassName: 'text-xs text-surface-400 whitespace-nowrap', cell: record => new Date(record.createdAt).toLocaleString() },
  { id: 'providerName', label: 'Provider', cellClassName: 'text-surface-200', cell: record => record.providerName },
  { id: 'model', label: 'Model', cellClassName: 'font-mono text-xs text-surface-200', cell: record => record.model },
  { id: 'status', label: 'Status', cell: record => <StatusBadge status={record.status} /> },
  { id: 'sourceType', label: 'Source', cellClassName: 'text-surface-300', cell: record => record.sourceType },
  { id: 'fileName', label: 'File', cellClassName: 'text-surface-300', cell: record => <span title={record.filePath ?? undefined}>{record.fileName ?? '—'}</span> },
  { id: 'prompt', label: 'Prompt', cellClassName: 'text-surface-300', cell: record => <span title={record.userMessage ?? undefined}>{promptPreview(record)}</span> },
  { id: 'inputHash', label: 'Input Hash', cellClassName: 'font-mono text-[11px] text-surface-500', cell: record => <span title={record.inputHash}>{record.inputHash.slice(0, 12)}</span> },
  { id: 'pdfSent', label: 'PDF Sent', cell: record => <YesNo value={record.pdfSent} /> },
  { id: 'pdfFileSize', label: 'PDF Size', cellClassName: 'text-right font-mono text-xs', cell: record => mediaSize(record.pdfFileSize) },
  { id: 'imageSent', label: 'Image Sent', cell: record => <YesNo value={record.imageSent} /> },
  { id: 'imageFileSize', label: 'Image Size', cellClassName: 'text-right font-mono text-xs', cell: record => mediaSize(record.imageFileSize) },
  { id: 'videoSent', label: 'Video Sent', cell: record => <YesNo value={record.videoSent} /> },
  { id: 'videoFileSize', label: 'Video Size', cellClassName: 'text-right font-mono text-xs', cell: record => mediaSize(record.videoFileSize) },
  { id: 'audioSent', label: 'Audio Sent', cell: record => <YesNo value={record.audioSent} /> },
  { id: 'audioFileSize', label: 'Audio Size', cellClassName: 'text-right font-mono text-xs', cell: record => mediaSize(record.audioFileSize) },
  { id: 'inputTokens', label: 'In', cellClassName: 'text-right font-mono text-xs', cell: record => formatNumber(record.inputTokens) },
  { id: 'outputTokens', label: 'Out', cellClassName: 'text-right font-mono text-xs', cell: record => formatNumber(record.outputTokens) },
  { id: 'latencyMs', label: 'Latency', cellClassName: 'text-right font-mono text-xs', cell: record => formatDuration(record.latencyMs) },
  { id: 'estimatedCost', label: 'Cost', cellClassName: 'text-right font-mono text-xs', cell: record => formatCurrency(record.estimatedCost ?? 0) },
  { id: 'suppressed', label: 'Suppressed', cell: record => record.suppressed ? <span className="rounded border border-surface-500/30 bg-surface-700 px-2 py-0.5 text-xs text-surface-300">Yes</span> : <span className="text-surface-500">No</span> },
]

export function ResultsArchiveTab() {
  const [records, setRecords] = useState<ArchivedRunResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [fileName, setFileName] = useState('')
  const [view, setView] = useState<'table' | 'charts'>('charts')
  const [tableView, setTableView] = useState<'records' | 'file' | 'prompt'>('records')
  const [visibility, setVisibility] = useState<'active' | 'all' | 'suppressed'>('all')
  const [archiveMode, setArchiveMode] = useState<'latest' | 'history'>('latest')
  const [sortField, setSortField] = useState<SortField>('completedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [columnOrder, setColumnOrder] = useState<SortField[]>(() => RECORD_COLUMNS.map(column => column.id))
  const [draggedColumn, setDraggedColumn] = useState<SortField | null>(null)

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
  const fileNames = useMemo(() => [...new Set(records.map(r => r.fileName || '(no file)'))].sort(), [records])
  const visibleRecords = useMemo(() => {
    if (archiveMode === 'history') return records
    const latest = new Map<string, ArchivedRunResult>()
    for (const record of records) {
      const key = record.recordKey || `${record.serviceProvider}|${record.model}|${record.inputHash}`
      const current = latest.get(key)
      const recordTime = Math.max(new Date(record.completedAt).getTime(), new Date(record.createdAt).getTime())
      const currentTime = current ? Math.max(new Date(current.completedAt).getTime(), new Date(current.createdAt).getTime()) : -Infinity
      if (!current || recordTime > currentTime || (recordTime === currentTime && record.id > current.id)) {
        latest.set(key, record)
      }
    }
    return Array.from(latest.values())
  }, [records, archiveMode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visibleRecords.filter(record => {
      if (visibility === 'active' && record.suppressed) return false
      if (visibility === 'suppressed' && !record.suppressed) return false
      if (provider && record.providerName !== provider) return false
      if (model && record.model !== model) return false
      if (status && record.status !== status) return false
      if (sourceType && record.sourceType !== sourceType) return false
      if (fileName && (record.fileName || '(no file)') !== fileName) return false
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
  }, [visibleRecords, query, provider, model, status, sourceType, fileName, visibility])

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'completedAt': cmp = new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(); break
        case 'createdAt': cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break
        case 'providerName': cmp = a.providerName.localeCompare(b.providerName); break
        case 'model': cmp = a.model.localeCompare(b.model); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'sourceType': cmp = a.sourceType.localeCompare(b.sourceType); break
        case 'fileName': cmp = (a.fileName ?? '').localeCompare(b.fileName ?? ''); break
        case 'prompt': cmp = promptPreview(a).localeCompare(promptPreview(b)); break
        case 'inputHash': cmp = a.inputHash.localeCompare(b.inputHash); break
        case 'pdfSent': cmp = Number(a.pdfSent) - Number(b.pdfSent); break
        case 'pdfFileSize': cmp = (a.pdfFileSize ?? 0) - (b.pdfFileSize ?? 0); break
        case 'imageSent': cmp = Number(a.imageSent) - Number(b.imageSent); break
        case 'imageFileSize': cmp = (a.imageFileSize ?? 0) - (b.imageFileSize ?? 0); break
        case 'videoSent': cmp = Number(a.videoSent) - Number(b.videoSent); break
        case 'videoFileSize': cmp = (a.videoFileSize ?? 0) - (b.videoFileSize ?? 0); break
        case 'audioSent': cmp = Number(a.audioSent) - Number(b.audioSent); break
        case 'audioFileSize': cmp = (a.audioFileSize ?? 0) - (b.audioFileSize ?? 0); break
        case 'inputTokens': cmp = a.inputTokens - b.inputTokens; break
        case 'outputTokens': cmp = a.outputTokens - b.outputTokens; break
        case 'latencyMs': cmp = a.latencyMs - b.latencyMs; break
        case 'estimatedCost': cmp = (a.estimatedCost ?? 0) - (b.estimatedCost ?? 0); break
        case 'suppressed': cmp = Number(a.suppressed) - Number(b.suppressed); break
      }
      return cmp * sign
    })
  }, [filtered, sortField, sortDir])

  const analysisRecords = useMemo(() => filtered.filter(record => !record.suppressed), [filtered])

  const summary = useMemo(() => {
    const successes = analysisRecords.filter(r => r.status === 'success')
    const totalCost = analysisRecords.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0)
    const avgLatency = successes.length
      ? successes.reduce((sum, r) => sum + r.latencyMs, 0) / successes.length
      : 0
    return {
      runs: analysisRecords.length,
      successes: successes.length,
      errors: analysisRecords.filter(r => r.status === 'error').length,
      skipped: analysisRecords.filter(r => r.status === 'skipped').length,
      tokens: analysisRecords.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost,
      avgLatency,
    }
  }, [analysisRecords])

  const byModel = useMemo(() => groupRecords(analysisRecords, r => r.model).slice(0, 12), [analysisRecords])
  const byProvider = useMemo(() => groupRecords(analysisRecords, r => r.providerName).slice(0, 12), [analysisRecords])
  const byStatus = useMemo(() => groupRecords(analysisRecords, r => r.status), [analysisRecords])
  const groupedRows = useMemo(() => {
    if (tableView === 'file') return groupRecords(analysisRecords, record => record.fileName || '(no file)')
    if (tableView === 'prompt') return groupRecords(analysisRecords, record => promptPreview(record))
    return []
  }, [analysisRecords, tableView])
  const visibleIds = useMemo(() => sorted.map(record => record.id), [sorted])
  const orderedColumns = useMemo(() => {
    const columnsById = new Map(RECORD_COLUMNS.map(column => [column.id, column]))
    return columnOrder.map(id => columnsById.get(id)).filter(Boolean) as typeof RECORD_COLUMNS
  }, [columnOrder])
  const selectedCount = selectedIds.size
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(dir => dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleVisibleSelection() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        visibleIds.forEach(id => next.delete(id))
      } else {
        visibleIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  function moveColumn(source: SortField, target: SortField) {
    if (source === target) return
    setColumnOrder(current => {
      const next = [...current]
      const from = next.indexOf(source)
      const to = next.indexOf(target)
      if (from === -1 || to === -1) return current
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  async function setSuppressedForSelected(suppressed: boolean) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await webApi.updateArchivedResultsSuppressed(ids, suppressed)
    setRecords(current => current.map(record => ids.includes(record.id) ? { ...record, suppressed } : record))
    setSelectedIds(new Set())
  }

  async function deleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const confirmed = window.confirm(`Delete ${ids.length} archived result${ids.length === 1 ? '' : 's'} permanently? This cannot be undone.`)
    if (!confirmed) return
    await webApi.deleteArchivedResults(ids)
    setRecords(current => current.filter(record => !ids.includes(record.id)))
    setSelectedIds(new Set())
  }

  function resetFilters() {
    setQuery('')
    setProvider('')
    setModel('')
    setStatus('')
    setSourceType('')
    setFileName('')
    setVisibility('all')
    setArchiveMode('latest')
    setTableView('records')
    setSelectedIds(new Set())
  }

  function exportArchiveXLSX() {
    const rows = sorted.map(record => ({
      ID: record.id,
      'Run ID': record.runId,
      'Record Key': record.recordKey,
      Status: record.status,
      Suppressed: record.suppressed ? 'Yes' : 'No',
      'Provider ID': record.providerId ?? '',
      Provider: record.providerName,
      'Service Provider': record.serviceProvider,
      Model: record.model,
      'Source Type': record.sourceType,
      'Source Label': record.sourceLabel,
      'System Prompt': record.systemPrompt ?? '',
      'System Prompt Hash': record.systemPromptHash ?? '',
      'User Message': record.userMessage ?? '',
      'User Message Hash': record.userMessageHash ?? '',
      'Input Hash': record.inputHash,
      'File Name': record.fileName ?? '',
      'File Path': record.filePath ?? '',
      'File Size': record.fileSize ?? '',
      'File Type': record.fileType ?? '',
      'File MIME Type': record.fileMimeType ?? '',
      'File Hash': record.fileHash ?? '',
      'File Metadata JSON': JSON.stringify(record.fileMetadata ?? null),
      'Batch Files JSON': JSON.stringify(record.batchFiles ?? null),
      'PDF Sent': record.pdfSent ? 'Yes' : 'No',
      'PDF File Size': record.pdfFileSize ?? '',
      'Image Sent': record.imageSent ? 'Yes' : 'No',
      'Image File Size': record.imageFileSize ?? '',
      'Video Sent': record.videoSent ? 'Yes' : 'No',
      'Video File Size': record.videoFileSize ?? '',
      'Audio Sent': record.audioSent ? 'Yes' : 'No',
      'Audio File Size': record.audioFileSize ?? '',
      'Input Tokens': record.inputTokens,
      'Output Tokens': record.outputTokens,
      'Total Tokens': record.totalTokens,
      'Local Input Tokens': record.localInputTokens ?? '',
      'Latency Ms': record.latencyMs,
      'Input Price Per 1M': record.inputPricePer1m ?? '',
      'Output Price Per 1M': record.outputPricePer1m ?? '',
      'Estimated Cost': record.estimatedCost ?? '',
      'Response Text': record.responseText ?? '',
      Error: record.error ?? '',
      'Request Payload JSON': JSON.stringify(record.requestPayload ?? null),
      'Response Payload JSON': JSON.stringify(record.responsePayload ?? null),
      'Run Started At': record.runStartedAt ?? '',
      'Completed At': record.completedAt,
      'Created At': record.createdAt,
      'Updated At': record.updatedAt,
    }))
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, 'Archive Records')
    XLSX.writeFile(workbook, `token-tester-archive-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function SortHeader({ field, children, className }: { field: SortField; children: ReactNode; className?: string }) {
    const active = sortField === field
    return (
      <th
        draggable
        onClick={() => toggleSort(field)}
        onDragStart={() => setDraggedColumn(field)}
        onDragOver={event => event.preventDefault()}
        onDrop={() => {
          if (draggedColumn) moveColumn(draggedColumn, field)
          setDraggedColumn(null)
        }}
        onDragEnd={() => setDraggedColumn(null)}
        title="Click to sort. Drag to move column."
        className={`cursor-move select-none px-4 py-2 text-left text-xs font-medium text-surface-400 ${draggedColumn === field ? 'bg-surface-800 text-surface-100' : ''} ${className ?? ''}`}
      >
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
        <FilterSelect value={fileName} onChange={setFileName} options={fileNames} label="All files" />
        <select value={archiveMode} onChange={e => setArchiveMode(e.target.value as typeof archiveMode)} className="input min-w-44">
          <option value="latest">Latest per checksum</option>
          <option value="history">All observations</option>
        </select>
        <select value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)} className="input min-w-36">
          <option value="active">Active only</option>
          <option value="all">Active + suppressed</option>
          <option value="suppressed">Suppressed only</option>
        </select>
        <button onClick={resetFilters} className="btn-secondary flex items-center gap-1.5">
          <X size={15} /> Reset
        </button>
        <button onClick={exportArchiveXLSX} disabled={sorted.length === 0} className="btn-secondary flex items-center gap-1.5">
          Export XLS
        </button>
        <div className="ml-auto flex rounded-lg border border-surface-700 bg-surface-850 p-1">
          <button onClick={() => setView('charts')} className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${view === 'charts' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>
            <BarChart3 size={14} /> Charts
          </button>
          <button onClick={() => setView('table')} className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 ${view === 'table' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>
            <Table2 size={14} /> Table
          </button>
        </div>
      </div>

      {view === 'table' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 p-3">
          <div className="flex rounded-lg border border-surface-700 bg-surface-850 p-1">
            <button onClick={() => setTableView('records')} className={`px-3 py-1.5 text-xs rounded-md ${tableView === 'records' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>Records</button>
            <button onClick={() => setTableView('file')} className={`px-3 py-1.5 text-xs rounded-md ${tableView === 'file' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>By File</button>
            <button onClick={() => setTableView('prompt')} className={`px-3 py-1.5 text-xs rounded-md ${tableView === 'prompt' ? 'bg-brand-gold text-brand-charcoal' : 'text-surface-400 hover:text-surface-100'}`}>By Prompt</button>
          </div>
          {tableView === 'records' && (
            <>
              <span className="text-xs text-surface-400">{selectedCount} selected</span>
              <button onClick={() => setSuppressedForSelected(true)} disabled={selectedCount === 0} className="btn-secondary flex items-center gap-1.5 text-xs">
                <EyeOff size={14} /> Suppress
              </button>
              <button onClick={() => setSuppressedForSelected(false)} disabled={selectedCount === 0} className="btn-secondary flex items-center gap-1.5 text-xs">
                <RotateCcw size={14} /> Restore
              </button>
              <button onClick={deleteSelected} disabled={selectedCount === 0} className="btn-danger flex items-center gap-1.5 text-xs">
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
          <span className="ml-auto text-xs text-surface-500">Suppressed records stay in the archive but are excluded from stats and charts.</span>
        </div>
      )}

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
              {tableView === 'records' ? (
                <tr>
                  <th className="px-4 py-2 text-left">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} aria-label="Select visible archive records" />
                  </th>
                  {orderedColumns.map(column => (
                    <SortHeader key={column.id} field={column.id} className={column.cellClassName?.includes('text-right') ? 'text-right' : undefined}>
                      {column.label}
                    </SortHeader>
                  ))}
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-surface-400">{tableView === 'file' ? 'File' : 'Prompt'}</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-surface-400">Runs</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-surface-400">Tokens</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-surface-400">Avg Latency</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-surface-400">Cost</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tableView === 'records' ? sorted.map(record => (
                  <tr key={record.id} className={`border-b border-surface-800 hover:bg-surface-850 ${record.suppressed ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelected(record.id)} aria-label={`Select archive record ${record.id}`} />
                    </td>
                    {orderedColumns.map(column => (
                      <td key={column.id} className={`px-4 py-2 ${column.cellClassName ?? ''}`}>
                        {column.cell(record)}
                      </td>
                    ))}
                  </tr>
                )) : groupedRows.map(row => (
                  <tr key={row.name} className="border-b border-surface-800 hover:bg-surface-850">
                    <td className="px-4 py-2 text-surface-200">{row.name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(row.runs)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(row.tokens)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatDuration(row.avgLatency)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatCurrency(row.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {((tableView === 'records' && sorted.length === 0) || (tableView !== 'records' && groupedRows.length === 0)) && (
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

function YesNo({ value }: { value: boolean }) {
  return value
    ? <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">Yes</span>
    : <span className="text-surface-500">No</span>
}

function mediaSize(value?: number | null) {
  return value && value > 0 ? formatFileSize(value) : '-'
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

function promptPreview(record: ArchivedRunResult) {
  const text = (record.userMessage || record.sourceLabel || '').replace(/\s+/g, ' ').trim()
  if (!text) return '(empty prompt)'
  const words = text.split(' ').slice(0, 8).join(' ')
  return words.length < text.length ? `${words}...` : words
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
