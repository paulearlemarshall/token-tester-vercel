import { useState } from 'react'
import { Play, Square, Loader2, CheckCircle, XCircle, Clock, Trash2, ChevronRight, ChevronDown, ChevronLeft, ToggleLeft, ToggleRight, Search, Copy, X, Check, ArrowUp, ArrowDown, List, FileText } from 'lucide-react'
import { useStore } from '../store'
import type { AttachedFile, DebugEntry, FileItem, TestRun } from '../types'
import { formatDuration, truncate } from '../utils/formatters'
import { webApi } from '../lib/web-api'

function buildMessages(systemPrompt: string, userMessage: string, providerType: string, file: AttachedFile | null): any[] {
  const messages: any[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  if (!file) {
    messages.push({ role: 'user', content: userMessage || 'Hello' })
    return messages
  }
  const content: any[] = [{ type: 'text', text: userMessage || `Analyze this file: ${file.name}` }]
  if (file.type === 'image' && (providerType === 'openai-compat' || providerType === 'anthropic' || providerType === 'gemini')) {
    content.push({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } })
  } else if (file.type === 'document' && providerType === 'openai-compat') {
    content.push({ type: 'file', file: { filename: file.name, file_data: `data:${file.mimeType};base64,${file.base64}` } })
  } else if (file.type === 'document' && (providerType === 'anthropic' || providerType === 'gemini')) {
    content.push({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.base64}` } })
  } else if (file.content) {
    content.push({ type: 'text', text: `\n\n\`\`\`\n${file.content}\n\`\`\`` })
  }
  messages.push({ role: 'user', content })
  return messages
}

function buildBatchMessages(systemPrompt: string, userMessage: string, files: AttachedFile[]): any[] {
  const messages: any[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })

  const parts: any[] = [{ type: 'text', text: userMessage || `Analyze the following ${files.length} files:` }]
  for (const f of files) {
    if (f.type === 'image') {
      parts.push({ type: 'text', text: `\n--- ${f.name} ---` })
      parts.push({ type: 'image_url', image_url: { url: `data:${f.mimeType};base64,${f.base64}` } })
    } else if (f.type === 'document') {
      parts.push({ type: 'text', text: `\n--- ${f.name} ---` })
      parts.push({ type: 'file', file: { filename: f.name, file_data: `data:${f.mimeType};base64,${f.base64}` } })
    } else if (f.content) {
      parts.push({ type: 'text', text: `\n--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\`` })
    }
  }
  messages.push({ role: 'user', content: parts })
  return messages
}

function needsCompletionTokens(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model) || model.toLowerCase().includes('reasoning')
}

function buildRequestBody(providerType: string, model: string, messages: any[], maxTokens: number): any {
  const body: any = { model, messages, max_tokens: maxTokens }
  if (providerType === 'openai-compat' && needsCompletionTokens(model)) {
    delete body.max_tokens
    body.max_completion_tokens = maxTokens
  }
  return body
}

function retryWithCompletionTokens(body: any, maxTokens: number): any {
  if (!body.max_tokens) return body
  const retry = { ...body }
  delete retry.max_tokens
  retry.max_completion_tokens = maxTokens
  return retry
}

export function RunTab() {
  const {
    config, systemPrompt, customPrompts, fileItems,
    queue, setQueue, updateRun, clearQueue,
    isRunning, setIsRunning, setActiveTab,
    modelScope, setModelScope, toggleAllModels,
    modelPricing, setModelPricing, builtinPricing,
    debugEntries, pushDebugEntry, clearDebugEntries,
  } = useStore()
  const [expandedProv, setExpandedProv] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [searches, setSearches] = useState<Record<string, string>>({})
  const [modalityFilters, setModalityFilters] = useState<Record<string, string | null>>({})
  const [sortModes, setSortModes] = useState<Record<string, 'active' | 'name-asc' | 'name-desc' | 'input-asc' | 'input-desc' | 'output-asc' | 'output-desc'>>({})
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [subTab, setSubTab] = useState<'queue' | 'output'>('queue')
  const [outputIndex, setOutputIndex] = useState(0)
  const [filterModel, setFilterModel] = useState<string | null>(null)
  const [filterFile, setFilterFile] = useState<string | null>(null)
  const [requestCollapsed, setRequestCollapsed] = useState(true)

  const enabledProviders = config.providers.filter((p: any) => p.enabled)

  function setSearch(providerId: string, value: string) {
    setSearches(s => ({ ...s, [providerId]: value }))
  }

  function toggleExpanded(id: string) {
    setExpandedProv(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function isModelSelected(providerId: string, modelId: string): boolean {
    const scope = modelScope[providerId]
    if (scope === undefined) return false
    return scope[modelId] === true
  }

  function getSelectedModels(providerId: string, models: string[]): string[] {
    return models.filter(m => isModelSelected(providerId, m))
  }

  const SORT_CYCLE: ('active' | 'name-asc' | 'name-desc' | 'input-asc' | 'input-desc' | 'output-asc' | 'output-desc')[] = [
    'active', 'name-asc', 'name-desc', 'input-asc', 'input-desc', 'output-asc', 'output-desc',
  ]
  function cycleSort(providerId: string) {
    setSortModes(s => {
      const cur = s[providerId] || 'name-asc'
      const idx = SORT_CYCLE.indexOf(cur)
      const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]
      return { ...s, [providerId]: next }
    })
  }

  function sortedModels(providerId: string, providerName: string, models: string[]): string[] {
    const sort = sortModes[providerName] || 'name-asc'
    if (sort === 'active') {
      return [...models].sort((a, b) => {
        const aSel = isModelSelected(providerId, a) ? 1 : 0
        const bSel = isModelSelected(providerId, b) ? 1 : 0
        if (aSel !== bSel) return bSel - aSel
        return a.localeCompare(b)
      })
    }
    const [field, dir] = sort.split('-') as ['name' | 'input' | 'output', 'asc' | 'desc']
    const sign = dir === 'asc' ? 1 : -1
    const sorted = [...models].sort((a, b) => {
      if (field === 'input') {
        return (effectivePricing(providerName, a).input - effectivePricing(providerName, b).input) * sign
      }
      if (field === 'output') {
        return (effectivePricing(providerName, a).output - effectivePricing(providerName, b).output) * sign
      }
      return a.localeCompare(b) * sign
    })
    return sorted
  }

  function filteredModels(providerId: string, models: string[]): string[] {
    const q = (searches[providerId] || '').toLowerCase()
    let list = q ? models.filter(m => m.toLowerCase().includes(q)) : models
    const modFilter = modalityFilters[providerId]
    if (modFilter) {
      const prov = config.providers.find((p: any) => p.id === providerId)
      const metas = prov?.modelMetas || []
      const modModelIds = new Set(metas.filter((m: any) => m.modality?.includes(modFilter)).map((m: any) => m.id))
      list = list.filter(m => modModelIds.has(m))
    }
    return list
  }

  function effectivePricing(providerName: string, modelId: string): { input: number; output: number } {
    const prefixed = `${providerName.toLowerCase()}/${modelId}`
    const override = modelPricing[prefixed]
    if (override && (override.input > 0 || override.output > 0)) return override
    if (builtinPricing[prefixed]) return { input: builtinPricing[prefixed].input, output: builtinPricing[prefixed].output }
    if (builtinPricing[modelId]) return { input: builtinPricing[modelId].input, output: builtinPricing[modelId].output }
    const short = modelId.includes('/') ? modelId.split('/').pop()! : modelId
    if (short !== modelId && builtinPricing[short]) return { input: builtinPricing[short].input, output: builtinPricing[short].output }
    const keys = Object.keys(builtinPricing).sort((a, b) => b.length - a.length)
    for (const key of keys) {
      if (prefixed.startsWith(key)) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
      if (modelId.startsWith(key)) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
      if (modelId.endsWith(`/${key}`)) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
    }
    return { input: 0, output: 0 }
  }

  function generateQueue() {
    const testCases: { label: string; sourceType: 'prompt' | 'file' | 'batch'; userMessage: string; file: AttachedFile | null; batchFiles?: AttachedFile[] }[] = []

    for (const p of customPrompts.filter((p: any) => p.enabled)) {
      testCases.push({ label: truncate(p.text, 60), sourceType: 'prompt', userMessage: p.text, file: null })
    }

    for (const item of fileItems) {
      const prompt = (item.prompt || '').trim()
      if (item.kind === 'file' && item.file) {
        testCases.push({ label: item.name, sourceType: 'file', userMessage: prompt, file: item.file })
      } else if (item.kind === 'folder' && item.files && item.files.length > 0) {
        const enabledFiles = item.files.filter(f => f.enabled !== false)
        if (enabledFiles.length === 0) continue
        if (item.mode === 'batch') {
          testCases.push({
            label: `${item.name} (batch ${enabledFiles.length})`,
            sourceType: 'batch',
            userMessage: prompt,
            file: null,
            batchFiles: enabledFiles,
          })
        } else {
          for (const f of enabledFiles) {
            testCases.push({ label: `${item.name}/${f.name}`, sourceType: 'file', userMessage: prompt, file: f })
          }
        }
      }
    }

    if (testCases.length === 0) {
      testCases.push({ label: '(default)', sourceType: 'prompt', userMessage: 'Hello', file: null })
    }

    const runs: TestRun[] = []
    for (const prov of enabledProviders) {
      const selected = getSelectedModels(prov.id, prov.models)
      for (const model of selected) {
        for (const tc of testCases) {
          runs.push({
            id: crypto.randomUUID(),
            providerId: prov.id,
            providerName: prov.name,
            model,
            sourceLabel: tc.label,
            sourceType: tc.sourceType,
            systemPrompt,
            userMessage: tc.userMessage,
            file: tc.file,
            batchFiles: tc.batchFiles,
            status: 'queued',
            timestamp: Date.now(),
            priceOverride: modelPricing[`${prov.name.toLowerCase()}/${model}`],
          })
        }
      }
    }
    setQueue(runs)
  }

  async function runAll() {
    if (queue.length === 0) return
    setIsRunning(true)
    setProgress({ completed: 0, total: queue.length })
    clearDebugEntries()

    const updated = queue.map((r: any) => ({ ...r, status: 'queued' as const }))
    setQueue(updated)

    for (let i = 0; i < updated.length; i++) {
      const run = updated[i]
      if (!useStore.getState().isRunning) break

      updateRun(run.id, { status: 'running' })

      const prov = config.providers.find((p: any) => p.id === run.providerId)
      if (!prov) {
        updateRun(run.id, { status: 'error', result: { inputTokens: 0, outputTokens: 0, totalTokens: 0, responseText: '', latencyMs: 0, error: 'Provider not found' } })
        setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
        continue
      }

      try {
        const messages = run.sourceType === 'batch' && run.batchFiles
          ? buildBatchMessages(run.systemPrompt, run.userMessage, run.batchFiles)
          : buildMessages(run.systemPrompt, run.userMessage, prov.type, run.file)
        let bodyPayload = buildRequestBody(prov.type, run.model, messages, 4096)

        let result = await webApi.chatCompletion({
          provider: { type: prov.type, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers },
          model: run.model,
          messages,
          maxTokens: 4096,
          requestBody: bodyPayload,
        })

        if (result.error && /max_tokens.*max_completion_tokens/i.test(result.error)) {
          bodyPayload = retryWithCompletionTokens(bodyPayload, 4096)
          result = await webApi.chatCompletion({
            provider: { type: prov.type, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers },
            model: run.model,
            messages,
            maxTokens: 4096,
            requestBody: bodyPayload,
          })
        }

        if (result.error && /invalid.*(mime|image|format)|file.*data.*missing/i.test(result.error)) {
          const retryFile = run.file ? { ...run.file, type: 'text' as const, content: run.file.content || `[${run.file.ext.toUpperCase()} file]` } : null
          const retryBatchFiles = run.batchFiles?.map((f: AttachedFile) => ({ ...f, type: 'text' as const, content: f.content || `[${f.ext.toUpperCase()} file]` }))
          const retryMessages = run.sourceType === 'batch' && retryBatchFiles
            ? buildBatchMessages(run.systemPrompt, run.userMessage, retryBatchFiles)
            : buildMessages(run.systemPrompt, run.userMessage, prov.type, retryFile)
          bodyPayload = buildRequestBody(prov.type, run.model, retryMessages, 4096)
          result = await webApi.chatCompletion({
            provider: { type: prov.type, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers },
            model: run.model,
            messages: retryMessages,
            maxTokens: 4096,
            requestBody: bodyPayload,
          })
        }

        const debug: DebugEntry = {
          provider: prov.name,
          model: run.model,
          request: bodyPayload,
          response: result,
          error: result.error,
          file: run.file?.name || (run.batchFiles ? `batch (${run.batchFiles.length})` : ''),
          filePath: run.file?.path,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latency: result.latencyMs,
        }
        pushDebugEntry(debug)

        let localTokens = 0
        try {
          const fullText = messages.map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(' ')
          localTokens = await webApi.countTokens(fullText)
        } catch { /* ignore */ }

        updateRun(run.id, {
          status: result.error ? 'error' : 'success',
          result,
          localInputTokens: localTokens || undefined,
        })
      } catch (err: any) {
        updateRun(run.id, {
          status: 'error',
          result: { inputTokens: 0, outputTokens: 0, totalTokens: 0, responseText: '', latencyMs: 0, error: err.message ?? String(err) },
        })
      }

      setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
    }

    setIsRunning(false)
  }

  function removeRun(id: string) {
    setQueue(queue.filter((r: TestRun) => r.id !== id))
  }

  function stopRun() { setIsRunning(false) }

  function copyDebug(json: string, idx: number) {
    navigator.clipboard.writeText(json)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  const successCount = queue.filter((r: any) => r.status === 'success').length
  const errorCount = queue.filter((r: any) => r.status === 'error').length
  const queuedCount = queue.filter((r: any) => r.status === 'queued').length

  const entry = debugEntries.length > 0 ? debugEntries[outputIndex] : null

  const filteredDebugEntries = debugEntries.filter(e =>
    (filterModel ? e.model === filterModel : true) &&
    (filterFile ? e.file === filterFile : true)
  )
  const uniqueModels = [...new Set(debugEntries.map(e => e.model))]
  const uniqueFiles = [...new Set(debugEntries.map(e => e.file).filter(Boolean) as string[])]
  const displayIndex = filteredDebugEntries.length > 0
    ? Math.min(outputIndex, filteredDebugEntries.length - 1)
    : 0
  const displayEntry = filteredDebugEntries.length > 0 ? filteredDebugEntries[displayIndex] : null

  function renderMarkdown(text: string): string {
    let html = text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-surface-950 rounded p-3 my-2 text-xs font-mono text-surface-200 overflow-x-auto"><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="bg-surface-800 text-indigo-300 px-1 rounded text-[11px]">$1</code>')
      .replace(/### (.+)/g, '<h3 class="text-sm font-semibold text-surface-200 mt-3 mb-1">$1</h3>')
      .replace(/## (.+)/g, '<h2 class="text-base font-semibold text-surface-200 mt-4 mb-1">$1</h2>')
      .replace(/# (.+)/g, '<h1 class="text-lg font-bold text-surface-200 mt-4 mb-2">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-surface-100">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)/gm, '<li class="text-surface-300 ml-4 list-disc">$1</li>')
    html = `<p class="text-surface-300 mb-2">${html.replace(/\n\n/g, '</p><p class="text-surface-300 mb-2">').replace(/\n/g, '<br/>')}</p>`
    return html
  }

  function formatLatency(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="p-6 pb-0 flex flex-col h-full">
      {isRunning && (
        <div className="card space-y-2 mb-3 shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-surface-300 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Running... {progress.completed}/{progress.total}
            </span>
            <span className="text-surface-400">
              {progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%
            </span>
          </div>
          <div className="w-full bg-surface-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center border-b border-surface-700 mb-4 shrink-0">
        <button
          onClick={() => setSubTab('queue')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            subTab === 'queue' ? 'border-indigo-400 text-surface-100' : 'border-transparent text-surface-400 hover:text-surface-200'
          }`}
        >
          <List size={14} className="inline mr-1.5" />Queue
        </button>
        <button
          onClick={() => { setSubTab('output'); setOutputIndex(0) }}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            subTab === 'output' ? 'border-indigo-400 text-surface-100' : 'border-transparent text-surface-400 hover:text-surface-200'
          }`}
        >
          <FileText size={14} className="inline mr-1.5" />Output
          {debugEntries.length > 0 && <span className="ml-1.5 text-surface-500">({debugEntries.length})</span>}
        </button>
      </div>

      {subTab === 'queue' ? (
        <div className="flex-1 overflow-y-auto space-y-6 min-h-0 pr-1">
          <div className="flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-xl font-bold text-surface-100">Run Tests</h2>
              <p className="text-sm text-surface-400 mt-1">
                {enabledProviders.length} provider{enabledProviders.length !== 1 ? 's' : ''} ·
                {customPrompts.filter((p: any) => p.enabled).length} prompt{customPrompts.filter((p: any) => p.enabled).length !== 1 ? 's' : ''} ·
                {fileItems.length} item{fileItems.length !== 1 ? 's' : ''} · {fileItems.reduce((s: number, f: FileItem) => s + (f.kind === 'folder' ? (f.files?.filter(ff => ff.enabled !== false).length ?? 0) : 1), 0)} file{fileItems.reduce((s: number, f: FileItem) => s + (f.kind === 'folder' ? (f.files?.filter(ff => ff.enabled !== false).length ?? 0) : 1), 0) !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={generateQueue} disabled={isRunning} className="btn-secondary flex items-center gap-1.5">
                <Clock size={16} /> Generate Queue
              </button>
              {!isRunning ? (
                <button onClick={runAll} disabled={queue.length === 0} className="btn-success flex items-center gap-1.5">
                  <Play size={16} /> Run All ({queue.length})
                </button>
              ) : (
                <button onClick={stopRun} className="btn-danger flex items-center gap-1.5">
                  <Square size={16} /> Stop
                </button>
              )}
              <button onClick={clearQueue} disabled={isRunning} className="btn-danger flex items-center gap-1.5">
                <Trash2 size={16} /> Clear
              </button>
            </div>
          </div>

          {successCount + errorCount > 0 && (
            <div className="flex gap-4">
              <div className="card flex items-center gap-2 px-4 py-2">
                <CheckCircle size={18} className="text-emerald-400" />
                <span className="text-sm text-surface-200">{successCount} succeeded</span>
              </div>
              <div className="card flex items-center gap-2 px-4 py-2">
                <XCircle size={18} className={errorCount > 0 ? 'text-red-400' : 'text-surface-500'} />
                <span className="text-sm text-surface-200">{errorCount} failed</span>
              </div>
              <div className="card flex items-center gap-2 px-4 py-2">
                <Clock size={18} className="text-surface-400" />
                <span className="text-sm text-surface-200">{queuedCount} pending</span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {enabledProviders.length === 0 ? (
              <div className="card text-center py-8">
                <p className="text-surface-400">No enabled providers</p>
                <p className="text-surface-500 text-sm mt-1">Configure and enable providers in the Configure tab</p>
              </div>
            ) : (
              enabledProviders.map((prov: any) => {
                const selectedCount = getSelectedModels(prov.id, prov.models).length
                const isExpanded = expandedProv.has(prov.id)
                const search = searches[prov.id] || ''
                const displayModels = sortedModels(prov.id, prov.name, filteredModels(prov.id, prov.models))
                return (
                  <div key={prov.id} className="card p-0 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3">
                      <button
                        onClick={() => toggleExpanded(prov.id)}
                        className="flex items-center gap-2 shrink-0"
                      >
                        {isExpanded ? <ChevronDown size={18} className="text-surface-400" /> : <ChevronRight size={18} className="text-surface-400" />}
                        <span className="font-semibold text-surface-100">{prov.name}</span>
                      </button>
                      <span className="text-xs text-surface-400">{prov.models.length} models</span>
                      <span className="badge-green text-[10px]">{selectedCount} in scope</span>

                      <div className="flex-1" />

                      {isExpanded && (
                        <>
                          <div className="relative w-48">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-surface-400" />
                            <input
                              className="input text-xs pl-7 py-1 h-7"
                              placeholder="Search models..."
                              value={search}
                              onChange={e => setSearch(prov.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                            {search && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-surface-500">
                                {displayModels.length}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); cycleSort(prov.name) }}
                            className="text-xs text-surface-400 hover:text-surface-200 flex items-center gap-0.5 shrink-0"
                            title={`Sort: ${sortModes[prov.name] || 'name-asc'}`}
                          >
                            {(() => {
                              const sm = sortModes[prov.name] || 'name-asc'
                              if (sm === 'active') return <><span className="text-indigo-400">Active</span></>
                              const [f] = sm.split('-')
                              const up = sm.endsWith('asc')
                              return (
                                <>
                                  {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                                  {f === 'input' ? 'Input' : f === 'output' ? 'Output' : 'Name'}
                                </>
                              )
                            })()}
                          </button>
                          {(() => {
                            const modalities = new Set<string>()
                            for (const m of (prov.modelMetas || [])) {
                              if (m.modality) m.modality.split('+').forEach((x: string) => { if (x.trim() !== 'text') modalities.add(x.trim()) })
                            }
                            const activeMod = modalityFilters[prov.id]
                            const modColors: Record<string, string> = {
                              image: 'bg-purple-600/20 text-purple-300 border-purple-600/40 active:bg-purple-600/40',
                              text: 'bg-blue-600/20 text-blue-300 border-blue-600/40 active:bg-blue-600/40',
                            }
                            return Array.from(modalities).map(mod => (
                              <button
                                key={mod}
                                onClick={e => { e.stopPropagation(); setModalityFilters(s => ({ ...s, [prov.id]: activeMod === mod ? null : mod })) }}
                                className={`text-xs shrink-0 rounded-full px-2.5 py-0.5 border transition-all font-medium ${
                                  activeMod === mod
                                    ? (modColors[mod] || 'bg-indigo-600/20 text-indigo-300 border-indigo-600/40')
                                    : 'bg-transparent text-surface-500 border-surface-600 hover:text-surface-300 hover:border-surface-500'
                                }`}
                              >
                                {mod === 'image' ? 'Vision' : mod}
                              </button>
                            ))
                          })()}
                          <button
                            onClick={e => { e.stopPropagation(); toggleAllModels(prov.id, true) }}
                            className="text-xs text-surface-400 hover:text-surface-200"
                          >All</button>
                          <button
                            onClick={e => { e.stopPropagation(); toggleAllModels(prov.id, false) }}
                            className="text-xs text-surface-400 hover:text-surface-200"
                          >None</button>
                        </>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t border-surface-700 p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-80 overflow-y-auto">
                        {displayModels.length === 0 ? (
                          <div className="col-span-full text-center py-4 text-xs text-surface-500">No models match "{search}"</div>
                        ) : (
                          displayModels.map((model: string) => {
                            const selected = isModelSelected(prov.id, model)
                            const meta = prov.modelMetas?.find((m: any) => m.id === model)
                            const pricing = effectivePricing(prov.name, model)
                            return (
                              <div
                                key={model}
                                className={`rounded-lg border p-3 transition-all ${
                                  selected
                                    ? 'bg-indigo-600/10 border-indigo-600/40 hover:bg-indigo-600/20'
                                    : 'bg-surface-850 border-surface-700 opacity-50 hover:opacity-80'
                                }`}
                              >
                                <div
                                  onClick={() => setModelScope(prov.id, model, !selected)}
                                  className="cursor-pointer"
                                >
                                  <div className="flex items-start justify-between mb-1">
                                    <span className={`text-xs font-mono font-medium leading-tight ${selected ? 'text-indigo-300' : 'text-surface-400'}`}>
                                      {model.length > 28 ? model.slice(0, 26) + '…' : model}
                                    </span>
                                    {selected ? (
                                      <ToggleRight size={16} className="text-indigo-400 shrink-0" />
                                    ) : (
                                      <ToggleLeft size={16} className="text-surface-500 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-[10px] text-surface-500 space-y-0.5">
                                    {meta?.owned_by && <p>by {meta.owned_by}</p>}
                                    {meta?.context_length && <p>ctx: {(meta.context_length / 1000).toFixed(0)}k</p>}
                                    {meta?.modality?.includes('image') && <p className="text-indigo-400 font-medium">vision</p>}
                                  </div>
                                </div>
                                <div className="flex gap-1 mt-2" onClick={e => e.stopPropagation()}>
                                  <div className="flex-1 min-w-0">
                                    <label className="text-[9px] text-surface-400 block leading-tight">In $/M</label>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      value={pricing.input || ''}
                                      onChange={e => setModelPricing(`${prov.name.toLowerCase()}/${model}`, parseFloat(e.target.value) || 0, pricing.output)}
                                      className="w-full bg-surface-800 border border-surface-600 rounded text-[10px] px-1 py-0.5 text-surface-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="0"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <label className="text-[9px] text-surface-400 block leading-tight">Out $/M</label>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      value={pricing.output || ''}
                                      onChange={e => setModelPricing(`${prov.name.toLowerCase()}/${model}`, pricing.input, parseFloat(e.target.value) || 0)}
                                      className="w-full bg-surface-800 border border-surface-600 rounded text-[10px] px-1 py-0.5 text-surface-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      placeholder="0"
                                    />
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {queue.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-surface-300 mb-2">Queue ({queue.length})</h3>
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {queue.map((run: TestRun) => (
                  <div key={run.id} className="card flex items-center gap-3 py-1.5 px-3">
                    {run.status === 'queued' && <Clock size={14} className="text-surface-500 shrink-0" />}
                    {run.status === 'running' && <Loader2 size={14} className="text-indigo-400 animate-spin shrink-0" />}
                    {run.status === 'success' && <CheckCircle size={14} className="text-emerald-400 shrink-0" />}
                    {run.status === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                    <span className="text-xs font-mono text-indigo-400 w-20 shrink-0 truncate">{run.providerName}</span>
                    <span className="text-xs font-mono text-surface-300 w-28 shrink-0 truncate">{run.model}</span>
                  <span className="text-xs text-surface-400 truncate flex-1">
                    {run.sourceType === 'prompt' ? '💬' : '📄'}{' '}
                    {(() => {
                      const fp = run.file?.path
                      return fp ? (
                        <span className="truncate max-w-[200px] inline-block align-bottom" title={fp}>
                          {run.sourceLabel}
                        </span>
                      ) : run.sourceLabel
                    })()}
                  </span>
                    {run.result && (
                      <span className="text-xs text-surface-500 shrink-0">
                        {run.result.totalTokens > 0 ? `${run.result.totalTokens} tok` : ''}
                        {run.result.latencyMs > 0 ? ` · ${formatDuration(run.result.latencyMs)}` : ''}
                      </span>
                    )}
                    {run.result?.error && (
                      <span className="text-xs text-red-400 truncate max-w-[150px] shrink-0" title={run.result.error}>
                        {truncate(run.result.error, 40)}
                      </span>
                    )}
                    <button
                      onClick={() => removeRun(run.id)}
                      disabled={run.status === 'running'}
                      className="text-surface-500 hover:text-red-400 disabled:opacity-30 shrink-0"
                      title="Remove from queue"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {queue.length > 0 && !isRunning && successCount > 0 && (
            <div className="flex justify-center">
              <button onClick={() => setActiveTab('results')} className="btn-primary">
                View Results
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {debugEntries.length === 0 ? (
            <div className="card text-center py-12">
              <FileText size={32} className="mx-auto text-surface-500 mb-2" />
              <p className="text-surface-400">No output yet</p>
              <p className="text-surface-500 text-sm mt-1">Run some tests and their request/response data will appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <select
                    value={filterModel || ''}
                    onChange={e => { setFilterModel(e.target.value || null); setFilterFile(null); setOutputIndex(0) }}
                    className="input text-xs py-1 pr-6 appearance-none cursor-pointer"
                  >
                    <option value="">All models</option>
                    {uniqueModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {filterModel && (
                    <button
                      onClick={() => { setFilterModel(null); setOutputIndex(0) }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="relative">
                  <select
                    value={filterFile || ''}
                    onChange={e => { setFilterFile(e.target.value || null); setFilterModel(null); setOutputIndex(0) }}
                    className="input text-xs py-1 pr-6 appearance-none cursor-pointer"
                  >
                    <option value="">All files</option>
                    {uniqueFiles.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  {filterFile && (
                    <button
                      onClick={() => { setFilterFile(null); setOutputIndex(0) }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOutputIndex(Math.max(0, displayIndex - 1))}
                    disabled={displayIndex === 0 || filteredDebugEntries.length === 0}
                    className="btn-secondary p-1.5 disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm text-surface-300 font-mono">
                    {filteredDebugEntries.length > 0 ? displayIndex + 1 : 0} / {filteredDebugEntries.length}
                  </span>
                  <button
                    onClick={() => setOutputIndex(Math.min(filteredDebugEntries.length - 1, displayIndex + 1))}
                    disabled={displayIndex === filteredDebugEntries.length - 1 || filteredDebugEntries.length === 0}
                    className="btn-secondary p-1.5 disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                <span className="text-[10px] text-surface-500">
                  {displayEntry?.error ? 'Error' : 'Success'}
                </span>
              </div>

              {displayEntry ? (
                <>
                  <div className="card bg-surface-850">
                    <div className="grid grid-cols-7 gap-4 text-xs">
                      <div>
                        <div className="text-surface-500 text-[10px]">Provider</div>
                        <div className="text-surface-200 font-mono truncate">{displayEntry.provider}</div>
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">Model</div>
                        <div className="text-surface-200 font-mono truncate">{displayEntry.model}</div>
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">File</div>
                        {displayEntry.filePath ? (
                          <div className="text-surface-300 truncate text-xs" title={displayEntry.filePath}>
                            {displayEntry.file}
                          </div>
                        ) : displayEntry.file ? (
                          <div className="text-surface-300 truncate text-xs">{displayEntry.file}</div>
                        ) : (
                          <div className="text-surface-300 truncate text-xs">—</div>
                        )}
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">In Tokens</div>
                        <div className="text-surface-200 font-mono">{displayEntry.inputTokens ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">Out Tokens</div>
                        <div className="text-surface-200 font-mono">{displayEntry.outputTokens ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">Total</div>
                        <div className="text-surface-200 font-mono">{(displayEntry.inputTokens != null && displayEntry.outputTokens != null) ? displayEntry.inputTokens + displayEntry.outputTokens : '—'}</div>
                      </div>
                      <div>
                        <div className="text-surface-500 text-[10px]">Latency</div>
                        <div className="text-surface-200 font-mono">{displayEntry.latency ? formatLatency(displayEntry.latency) : '—'}</div>
                      </div>
                    </div>
                  </div>

                  {displayEntry.error ? (
                    <div className="card bg-red-900/20 border border-red-800/50">
                      <h4 className="text-xs font-semibold text-red-400 mb-2">Error</h4>
                      <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">{displayEntry.error}</pre>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="card">
                        <div className="flex items-center justify-between mb-0">
                          <button
                            onClick={() => setRequestCollapsed(!requestCollapsed)}
                            className="flex items-center gap-1 text-xs font-semibold text-surface-400 hover:text-surface-200"
                          >
                            {requestCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            → Request
                          </button>
                          <button
                            onClick={() => copyDebug(JSON.stringify(displayEntry.request, null, 2), -3)}
                            className="text-surface-400 hover:text-surface-200"
                          >
                            {copiedIdx === -3 ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          </button>
                        </div>
                        {!requestCollapsed && (
                          <pre className="text-xs text-surface-200 font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto mt-2">{JSON.stringify(displayEntry.request, null, 2)}</pre>
                        )}
                      </div>
                      <div className="card">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-surface-400">← Response</h4>
                          <button
                            onClick={() => copyDebug(JSON.stringify(displayEntry.response, null, 2), -4)}
                            className="text-surface-400 hover:text-surface-200"
                          >
                            {copiedIdx === -4 ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          </button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayEntry.response?.responseText || displayEntry.response?.content || JSON.stringify(displayEntry.response, null, 2)) }} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="card text-center py-8">
                  <p className="text-surface-400 text-sm">No records match the current filters</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
