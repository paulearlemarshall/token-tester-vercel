import React, { useState, useMemo } from 'react'
import { Download, Table2, BarChart3, CheckCircle, XCircle, Clock, DollarSign, FileText, FileSpreadsheet, ArrowUp, ArrowDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import * as XLSX from 'xlsx'
import { useStore } from '../store'
import { formatCurrency, formatNumber, formatDuration, formatFileSize, estimateCost, truncate } from '../utils/formatters'
import type { PriceEntry, AttachedFile } from '../types'
import { canonicalProviderKey } from '../lib/provider-key'

type SortField = 'provider' | 'model' | 'inRate' | 'outRate' | 'input' | 'output' | 'total' | 'cost' | 'latency' | 'status' | 'fileSize' | 'fileMeta' | 'file'

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#ef4444', '#14b8a6', '#a855f7']

function lookupBuiltin(model: string, pricing: Record<string, PriceEntry | null>): PriceEntry | null {
  if (pricing[model]) return pricing[model]
  const short = model.includes('/') ? model.split('/').pop()! : model
  if (short !== model && pricing[short]) return pricing[short]
  const keys = Object.keys(pricing).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (model.startsWith(key)) return pricing[key]
    if (model.endsWith(`/${key}`)) return pricing[key]
  }
  return null
}

function getRate(run: { priceOverride?: { input: number; output: number }; providerName: string; model: string }, pricing: Record<string, PriceEntry | null>): { input: number; output: number; per: string } | null {
  if (run.priceOverride && (run.priceOverride.input > 0 || run.priceOverride.output > 0)) {
    return { input: run.priceOverride.input, output: run.priceOverride.output, per: '1M' }
  }
  const key = `${canonicalProviderKey(run.providerName)}/${run.model}`
  if (pricing[key]) return pricing[key]
  return lookupBuiltin(run.model, pricing)
}

export function ResultsTab() {
  const { queue, builtinPricing } = useStore()
  const [view, setView] = useState<'table' | 'charts'>('table')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const results = queue.filter(r => r.status === 'success' || r.status === 'error' || r.status === 'skipped')

  const completed = results.filter(r => r.status === 'success')
  const skipped = results.filter(r => r.status === 'skipped')

  const totalInputTokens = completed.reduce((s, r) => s + (r.result?.inputTokens ?? 0), 0)
  const totalOutputTokens = completed.reduce((s, r) => s + (r.result?.outputTokens ?? 0), 0)

  function getFileMeta(file: AttachedFile | null): string {
    if (!file?.metadata) return ''
    if (file.type === 'image') {
      const w = file.metadata.width
      const h = file.metadata.height
      if (w || h) return `${w}×${h}`
    }
    if (file.ext === '.pdf') {
      const p = file.metadata.pages
      const t = file.metadata.type
      if (p || t) return `${p}p ${t === 'digital' ? '(text)' : t === 'scanned' ? '(scan)' : ''}`
    }
    return ''
  }

  const totalCost = completed.reduce((s, r) => {
    const rate = getRate(r, builtinPricing)
    return s + estimateCost(r.result?.inputTokens ?? 0, r.result?.outputTokens ?? 0, rate)
  }, 0)

  const avgLatency = completed.length > 0
    ? completed.reduce((s, r) => s + (r.result?.latencyMs ?? 0), 0) / completed.length
    : 0

  const totalRunTimeMs = (() => {
    const done = queue.filter(r => r.status === 'success' || r.status === 'error')
    if (done.length < 2) return 0
    const start = Math.min(...done.map(r => r.timestamp))
    const end = Math.max(...done.map(r => r.timestamp + (r.result?.latencyMs ?? 0)))
    return end - start
  })()

  const byModel = useMemo(() => {
    const map = new Map<string, { runs: number; inputTokens: number; outputTokens: number; inputCost: number; outputCost: number; cost: number; latencyMs: number[] }>()
    for (const r of completed) {
      const key = `${canonicalProviderKey(r.providerName)}/${r.model}`
      const entry = map.get(key) || { runs: 0, inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, cost: 0, latencyMs: [] }
      const rate = getRate(r, builtinPricing)
      const divisor = rate?.per === '1K' ? 1000 : 1_000_000
      const inCost = rate ? (r.result?.inputTokens ?? 0) / divisor * rate.input : 0
      const outCost = rate ? (r.result?.outputTokens ?? 0) / divisor * rate.output : 0
      entry.runs++
      entry.inputTokens += r.result?.inputTokens ?? 0
      entry.outputTokens += r.result?.outputTokens ?? 0
      entry.inputCost += inCost
      entry.outputCost += outCost
      entry.cost += inCost + outCost
      entry.latencyMs.push(r.result?.latencyMs ?? 0)
      map.set(key, entry)
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      name: k,
      ...v,
      avgLatency: Math.round(v.latencyMs.reduce((a, b) => a + b, 0) / v.latencyMs.length),
    }))
  }, [completed, builtinPricing])

  const byFile = useMemo(() => {
    const map = new Map<string, { runs: number; inputTokens: number; outputTokens: number; inputCost: number; outputCost: number; cost: number; latencyMs: number[] }>()
    for (const r of completed) {
      const fileName = r.file?.name || '(no file)'
      const entry = map.get(fileName) || { runs: 0, inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, cost: 0, latencyMs: [] }
      const rate = getRate(r, builtinPricing)
      const divisor = rate?.per === '1K' ? 1000 : 1_000_000
      const inCost = rate ? (r.result?.inputTokens ?? 0) / divisor * rate.input : 0
      const outCost = rate ? (r.result?.outputTokens ?? 0) / divisor * rate.output : 0
      entry.runs++
      entry.inputTokens += r.result?.inputTokens ?? 0
      entry.outputTokens += r.result?.outputTokens ?? 0
      entry.inputCost += inCost
      entry.outputCost += outCost
      entry.cost += inCost + outCost
      entry.latencyMs.push(r.result?.latencyMs ?? 0)
      map.set(fileName, entry)
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      name: k,
      ...v,
      avgLatency: Math.round(v.latencyMs.reduce((a, b) => a + b, 0) / v.latencyMs.length),
    }))
  }, [completed, builtinPricing])

  const byFileModel = useMemo(() => {
    const fileSet = new Set<string>()
    const modelSet = new Set<string>()
    const map = new Map<string, { file: string; model: string; inputTokens: number; outputTokens: number; inputCost: number; outputCost: number }>()
    for (const r of completed) {
      const fileName = r.file?.name || '(no file)'
      const modelKey = r.model.includes('/') ? r.model.split('/').pop()! : r.model
      const key = `${fileName}||${modelKey}`
      const rate = getRate(r, builtinPricing)
      const divisor = rate?.per === '1K' ? 1000 : 1_000_000
      const inCost = rate ? (r.result?.inputTokens ?? 0) / divisor * rate.input : 0
      const outCost = rate ? (r.result?.outputTokens ?? 0) / divisor * rate.output : 0
      const entry = map.get(key) || { file: fileName, model: modelKey, inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0 }
      entry.inputTokens += r.result?.inputTokens ?? 0
      entry.outputTokens += r.result?.outputTokens ?? 0
      entry.inputCost += inCost
      entry.outputCost += outCost
      map.set(key, entry)
      fileSet.add(fileName)
      modelSet.add(modelKey)
    }
    const files = Array.from(fileSet).sort()
    const models = Array.from(modelSet).sort()
    const data = files.map(file => {
      const row: Record<string, any> = { name: file }
      for (const m of models) {
        const entry = map.get(`${file}||${m}`)
        row[`${m}-input`] = entry?.inputTokens ?? 0
        row[`${m}-output`] = entry?.outputTokens ?? 0
        row[`${m}-inputCost`] = entry?.inputCost ?? 0
        row[`${m}-outputCost`] = entry?.outputCost ?? 0
      }
      return row
    })
    return { data, models }
  }, [completed, builtinPricing])

  const sortedResults = useMemo(() => {
    if (!sortField) return results
    const arr = [...results]
    arr.sort((a, b) => {
      const rateA = getRate(a, builtinPricing)
      const rateB = getRate(b, builtinPricing)
      const costA = a.status === 'skipped' ? 0 : estimateCost(a.result?.inputTokens ?? 0, a.result?.outputTokens ?? 0, rateA)
      const costB = b.status === 'skipped' ? 0 : estimateCost(b.result?.inputTokens ?? 0, b.result?.outputTokens ?? 0, rateB)
      let cmp = 0
      switch (sortField) {
        case 'provider': cmp = (a.providerName || '').localeCompare(b.providerName || ''); break
        case 'model': cmp = (a.model || '').localeCompare(b.model || ''); break
        case 'inRate': cmp = (rateA?.input ?? 0) - (rateB?.input ?? 0); break
        case 'outRate': cmp = (rateA?.output ?? 0) - (rateB?.output ?? 0); break
        case 'input': cmp = (a.result?.inputTokens ?? 0) - (b.result?.inputTokens ?? 0); break
        case 'output': cmp = (a.result?.outputTokens ?? 0) - (b.result?.outputTokens ?? 0); break
        case 'total': cmp = (a.result?.totalTokens ?? 0) - (b.result?.totalTokens ?? 0); break
        case 'cost': cmp = costA - costB; break
        case 'latency': cmp = (a.result?.latencyMs ?? 0) - (b.result?.latencyMs ?? 0); break
        case 'status': cmp = (a.status || '').localeCompare(b.status || ''); break
        case 'fileSize': cmp = (a.file?.size ?? 0) - (b.file?.size ?? 0); break
        case 'fileMeta': cmp = (getFileMeta(a.file) || '').localeCompare(getFileMeta(b.file) || ''); break
        case 'file': cmp = (a.file?.name || '').localeCompare(b.file?.name || ''); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [results, sortField, sortDir, builtinPricing])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function SortHeader({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) {
    const active = sortField === field
    return (
      <th
        onClick={() => toggleSort(field)}
        className={`cursor-pointer select-none ${className || ''}`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active ? (
            sortDir === 'asc' ? <ArrowUp size={10} className="text-brand-gold" /> : <ArrowDown size={10} className="text-brand-gold" />
          ) : (
            <ArrowUp size={10} className="text-surface-600 opacity-0 group-hover:opacity-100" />
          )}
        </span>
      </th>
    )
  }

  async function exportJSON() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `token-tester-results-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportCSV() {
    const headers = ['Provider', 'Model', 'Prompt', 'File', 'File Size', 'File Info', 'Status', 'Input $/M', 'Output $/M', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Latency (ms)', 'Error']
    const rows = results.map(r => {
      const rate = getRate(r, builtinPricing)
      return [
        r.providerName, r.model, truncate(r.sourceLabel, 100), r.file?.name ?? '',
        r.file ? formatFileSize(r.file.size) : '', getFileMeta(r.file),
        r.status, rate?.input ?? '', rate?.output ?? '',
        r.result?.inputTokens ?? '', r.result?.outputTokens ?? '',
        r.result?.totalTokens ?? '', r.result?.latencyMs ?? '', r.result?.error ?? '',
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `token-tester-results-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportXLSX() {
    const rate = (r: typeof results[number]) => { try { return getRate(r, builtinPricing) } catch { return null } }
    const data = results.map(r => ({
      Provider: r.providerName,
      Model: r.model,
      Prompt: r.sourceLabel,
      File: r.file?.name ?? '',
      'File Size': r.file ? formatFileSize(r.file.size) : '',
      'File Info': getFileMeta(r.file),
      Status: r.status,
      'Input $/M': rate(r)?.input ?? 0,
      'Output $/M': rate(r)?.output ?? 0,
      'Input Tokens': r.result?.inputTokens ?? 0,
      'Output Tokens': r.result?.outputTokens ?? 0,
      'Total Tokens': r.result?.totalTokens ?? 0,
      'Latency (ms)': r.status === 'skipped' ? 0 : (r.result?.latencyMs ?? 0),
      Error: r.result?.error ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Results')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `token-tester-results-${Date.now()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (results.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-surface-100 mb-2">Results</h2>
        <div className="card text-center py-12">
          <BarChart3 size={32} className="mx-auto text-surface-500 mb-2" />
          <p className="text-surface-400">No test results yet</p>
          <p className="text-surface-500 text-sm mt-1">Run some tests first, then come here to analyze</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-surface-100">Results</h2>
        <div className="flex gap-2">
          <div className="flex bg-surface-800 rounded-lg p-0.5 border border-surface-700">
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === 'table' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'}`}
            >
              <Table2 size={14} className="inline mr-1" /> Table
            </button>
            <button
              onClick={() => setView('charts')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === 'charts' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'}`}
            >
              <BarChart3 size={14} className="inline mr-1" /> Charts
            </button>
          </div>
          <button onClick={exportJSON} className="btn-secondary text-xs flex items-center gap-1">
            <Download size={14} /> JSON
          </button>
          <button onClick={exportCSV} className="btn-secondary text-xs flex items-center gap-1">
            <Download size={14} /> CSV
          </button>
          <button onClick={exportXLSX} className="btn-secondary text-xs flex items-center gap-1">
            <FileSpreadsheet size={14} /> XLSX
          </button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <CheckCircle size={14} /> Completed
          </div>
          <p className="text-2xl font-bold text-surface-100">{completed.length}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <FileText size={14} /> Total Tokens
          </div>
          <p className="text-2xl font-bold text-surface-100">{formatNumber(totalInputTokens + totalOutputTokens)}</p>
          <p className="text-xs text-surface-500">in: {formatNumber(totalInputTokens)} / out: {formatNumber(totalOutputTokens)}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <DollarSign size={14} /> Est. Cost
          </div>
          <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalCost)}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <Clock size={14} /> Avg Latency
          </div>
          <p className="text-2xl font-bold text-surface-100">{formatDuration(avgLatency)}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <Clock size={14} /> Skipped
          </div>
          <p className="text-2xl font-bold text-surface-100">{skipped.length}</p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-surface-400 text-xs mb-1">
            <Clock size={14} /> Total Time
          </div>
          <p className="text-2xl font-bold text-surface-100">{totalRunTimeMs > 0 ? formatDuration(totalRunTimeMs) : '—'}</p>
        </div>
      </div>

      {view === 'table' ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-800 sticky top-0">
                <tr className="group">
                  <SortHeader field="provider" className="text-left px-4 py-2 text-surface-400 font-medium text-xs">Provider</SortHeader>
                  <SortHeader field="model" className="text-left px-4 py-2 text-surface-400 font-medium text-xs">Model</SortHeader>
                  <SortHeader field="inRate" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">In $/M</SortHeader>
                  <SortHeader field="outRate" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Out $/M</SortHeader>
                  <SortHeader field="input" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Input</SortHeader>
                  <SortHeader field="output" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Output</SortHeader>
                  <SortHeader field="total" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Total</SortHeader>
                  <SortHeader field="cost" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Cost</SortHeader>
                  <SortHeader field="latency" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Latency</SortHeader>
                  <SortHeader field="status" className="text-center px-4 py-2 text-surface-400 font-medium text-xs">Status</SortHeader>
                  <SortHeader field="fileSize" className="text-right px-4 py-2 text-surface-400 font-medium text-xs">Size</SortHeader>
                  <SortHeader field="fileMeta" className="text-left px-4 py-2 text-surface-400 font-medium text-xs">Meta</SortHeader>
                  <SortHeader field="file" className="text-left px-4 py-2 text-surface-400 font-medium text-xs">File</SortHeader>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map(r => {
                  const rate = getRate(r, builtinPricing)
                  const cost = r.status === 'skipped' ? 0 : estimateCost(r.result?.inputTokens ?? 0, r.result?.outputTokens ?? 0, rate)
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)}
                      className="border-t border-surface-700 hover:bg-surface-800/50 cursor-pointer"
                    >
                      <td className="px-4 py-2 text-surface-200 font-mono text-xs">{r.providerName}</td>
                      <td className="px-4 py-2 text-surface-200 font-mono text-xs">{r.model}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{rate ? formatCurrency(rate.input) : '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{rate ? formatCurrency(rate.output) : '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{formatNumber(r.result?.inputTokens ?? 0)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{formatNumber(r.result?.outputTokens ?? 0)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{formatNumber(r.result?.totalTokens ?? 0)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-emerald-400">{formatCurrency(cost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{r.result?.latencyMs ? formatDuration(r.result.latencyMs) : '—'}</td>
                      <td className="px-4 py-2 text-center">
                        {r.status === 'success' && <CheckCircle size={14} className="inline text-emerald-400" />}
                        {r.status === 'error' && <XCircle size={14} className="inline text-red-400" />}
                        {r.status === 'skipped' && <Clock size={14} className="inline text-surface-400" />}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-surface-300">{r.file ? formatFileSize(r.file.size) : '—'}</td>
                      <td className="px-4 py-2 text-left font-mono text-xs text-surface-300">{getFileMeta(r.file) || '—'}</td>
                      <td className="px-4 py-2 text-surface-400 text-xs max-w-[120px] truncate">
                        {(() => {
                          const fp = r.file?.path
                          return fp ? (
                            <span className="truncate block max-w-full" title={fp}>
                              {r.file!.name}
                            </span>
                          ) : '—'
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Token Usage by Model</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                <Legend />
                <Bar dataKey="inputTokens" name="Input Tokens" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outputTokens" name="Output Tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Token Usage by File</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byFile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                <Legend />
                <Bar dataKey="inputTokens" name="Input Tokens" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outputTokens" name="Output Tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Cost by Model</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const total = payload.reduce((s, p) => s + (p.value as number), 0)
                    return (
                      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-xs shadow-xl">
                        <p className="text-surface-300 font-semibold mb-1">{label}</p>
                        {payload.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-surface-200">
                            <span style={{ background: p.color, width: 8, height: 8, borderRadius: 2, display: 'inline-block' }} />
                            {p.name}: {formatCurrency(p.value as number)}
                          </div>
                        ))}
                        <div className="border-t border-surface-700 mt-1 pt-1 text-surface-100 font-semibold">
                          Total: {formatCurrency(total)}
                        </div>
                      </div>
                    )
                  }}
                />
                <Legend />
                <Bar dataKey="inputCost" name="Input Cost" fill="#6366f1" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="outputCost" name="Output Cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Cost by File</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byFile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const total = payload.reduce((s, p) => s + (p.value as number), 0)
                    return (
                      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-xs shadow-xl">
                        <p className="text-surface-300 font-semibold mb-1">{label}</p>
                        {payload.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-surface-200">
                            <span style={{ background: p.color, width: 8, height: 8, borderRadius: 2, display: 'inline-block' }} />
                            {p.name}: {formatCurrency(p.value as number)}
                          </div>
                        ))}
                        <div className="border-t border-surface-700 mt-1 pt-1 text-surface-100 font-semibold">
                          Total: {formatCurrency(total)}
                        </div>
                      </div>
                    )
                  }}
                />
                <Legend />
                <Bar dataKey="inputCost" name="Input Cost" fill="#6366f1" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="outputCost" name="Output Cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Tokens by File × Model</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byFileModel.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-xs shadow-xl">
                        <p className="text-surface-300 font-semibold mb-1">{label}</p>
                        {payload.filter(p => p.value && Number(p.value) > 0).map((p, i) => (
                          <div key={i} className="text-surface-200">{p.name}: {formatNumber(p.value as number)}</div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Legend />
                {byFileModel.models.flatMap(m => [
                  <Bar key={`${m}-input`} dataKey={`${m}-input`} name={`${m} In`} stackId={m} fill={CHART_COLORS[byFileModel.models.indexOf(m) % CHART_COLORS.length]} radius={[0, 0, 0, 0]} />,
                  <Bar key={`${m}-output`} dataKey={`${m}-output`} name={`${m} Out`} stackId={m} fill={CHART_COLORS[byFileModel.models.indexOf(m) % CHART_COLORS.length]} radius={[4, 4, 0, 0]} opacity={0.6} />,
                ])}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Cost by File × Model</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byFileModel.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0)
                    return (
                      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-xs shadow-xl">
                        <p className="text-surface-300 font-semibold mb-1">{label}</p>
                        {payload.filter(p => p.value && Number(p.value) > 0).map((p, i) => (
                          <div key={i} className="text-surface-200">{p.name}: {formatCurrency(p.value as number)}</div>
                        ))}
                        <div className="border-t border-surface-700 mt-1 pt-1 text-surface-100 font-semibold">Total: {formatCurrency(total)}</div>
                      </div>
                    )
                  }}
                />
                <Legend />
                {byFileModel.models.flatMap(m => [
                  <Bar key={`${m}-inputCost`} dataKey={`${m}-inputCost`} name={`${m} In`} stackId={m} fill={CHART_COLORS[byFileModel.models.indexOf(m) % CHART_COLORS.length]} radius={[0, 0, 0, 0]} />,
                  <Bar key={`${m}-outputCost`} dataKey={`${m}-outputCost`} name={`${m} Out`} stackId={m} fill={CHART_COLORS[byFileModel.models.indexOf(m) % CHART_COLORS.length]} radius={[4, 4, 0, 0]} opacity={0.6} />,
                ])}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Latency by Model (ms)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => `${Number(value ?? 0)}ms`}
                />
                <Bar dataKey="avgLatency" name="Avg Latency (ms)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-300 mb-4">Latency by File (ms)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byFile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => `${Number(value ?? 0)}ms`}
                />
                <Bar dataKey="avgLatency" name="Avg Latency (ms)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {expandedRow && (
        <div className="card">
          {(() => {
            const r = results.find(x => x.id === expandedRow)
            if (!r) return null
            return (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-surface-100">Run Detail</h3>
                  <button onClick={() => setExpandedRow(null)} className="text-surface-400 hover:text-surface-200 text-xs">Close</button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div><span className="text-surface-400">Provider:</span> <span className="text-surface-200">{r.providerName}</span></div>
                  <div><span className="text-surface-400">Model:</span> <span className="text-surface-200">{r.model}</span></div>
                  <div><span className="text-surface-400">File:</span> <span className="text-surface-200">{r.file?.name ?? '—'}</span></div>
                  <div><span className="text-surface-400">Status:</span> <span className={r.status === 'success' ? 'text-emerald-400' : r.status === 'skipped' ? 'text-surface-400' : 'text-red-400'}>{r.status}</span></div>
                  <div><span className="text-surface-400">Input Tokens:</span> <span className="text-surface-200">{formatNumber(r.result?.inputTokens ?? 0)}</span></div>
                  <div><span className="text-surface-400">Output Tokens:</span> <span className="text-surface-200">{formatNumber(r.result?.outputTokens ?? 0)}</span></div>
                  <div><span className="text-surface-400">Total Tokens:</span> <span className="text-surface-200">{formatNumber(r.result?.totalTokens ?? 0)}</span></div>
                  <div><span className="text-surface-400">Latency:</span> <span className="text-surface-200">{formatDuration(r.result?.latencyMs ?? 0)}</span></div>
                </div>
                {r.result?.error && (
                  <div className={`rounded border p-3 ${r.status === 'skipped' ? 'border-surface-700 bg-surface-900' : 'border-red-800 bg-red-900/30'}`}>
                    <p className={`text-xs font-mono whitespace-pre-wrap ${r.status === 'skipped' ? 'text-surface-300' : 'text-red-400'}`}>{r.result.error}</p>
                  </div>
                )}
                <div>
                  <p className="text-surface-400 text-xs mb-1">Response (first 500 chars):</p>
                  <pre className="bg-surface-950 rounded p-3 text-xs font-mono text-surface-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {truncate(r.result?.responseText ?? '(empty)', 500)}
                  </pre>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
