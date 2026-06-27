import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Search, ToggleLeft, ToggleRight, X } from 'lucide-react'
import { useStore } from '../store'
import type { ModelPreset, ModelPresetModel, ProviderConfig } from '../types'
import { webApi } from '../lib/web-api'
import { canonicalProviderKey, effectivePricing as resolveEffectivePricing, type ProviderKeyInput } from '../lib/provider-key'
import { getAttachmentCapabilities, getProviderAdapter } from '../lib/provider-registry'
import { CAPABILITY_LABELS, CAPABILITY_STYLES, inferModelCapabilities, type ModelCapability } from '../utils/model-capabilities'

type SelectedModelSortField = 'provider' | 'model' | 'input' | 'output'
type ProviderModelSort = 'active' | 'name-asc' | 'name-desc' | 'input-asc' | 'input-desc' | 'output-asc' | 'output-desc'
type SelectedModelRow = {
  provider: ProviderConfig
  model: string
  available: boolean
  pricing: { input: number; output: number }
  meta: any
}

function usesCompletionTokensParam(model: string): boolean {
  const m = model.toLowerCase()
  return /^o\d/.test(m) || m.includes('/o1') || m.includes('/o3') || m.includes('/o4') || m.startsWith('gpt-5') || m.includes('gpt-5') || m.includes('reasoning')
}

function providerHandlingDetails(provider: ProviderConfig, selectedModels: string[]) {
  const adapter = getProviderAdapter(provider)
  const caps = getAttachmentCapabilities(provider)
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || ''
  const selected = selectedModels.length > 0 ? selectedModels : provider.models ?? []
  const deepseekRouted = selected.filter((model: string) => model.toLowerCase().includes('deepseek'))
  const completionTokenModels = selected.filter(usesCompletionTokensParam)

  const endpoint = (() => {
    switch (adapter.id) {
      case 'openai': return `${baseUrl}/v1/responses`
      case 'xai': return `${baseUrl}/v1/responses`
      case 'anthropic': return 'https://api.anthropic.com/v1/messages'
      case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
      default: return `${baseUrl}/v1/chat/completions`
    }
  })()

  const requestShape = (() => {
    switch (adapter.id) {
      case 'openai':
        return [
          'Text/image/doc: /v1/responses, body { model, input, instructions?, max_output_tokens }',
          '  Content parts: input_text, input_image, input_file.',
          'Audio on chat models (gpt-audio*): /v1/chat/completions, body { model, messages, max_tokens } with input_audio parts.',
          'Audio on transcription models (whisper*, gpt-4o-transcribe*): /v1/audio/transcriptions, multipart form upload.',
        ]
      case 'xai':
        return [
          'Body: { model, input, max_output_tokens: 4096 }',
          'input contains optional system message plus user content parts.',
          'Text uses input_text. Images use input_image with data URLs.',
          'Documents are uploaded first to /v1/files, then referenced as input_file by file_id.',
          'Audio is transcribed first through /v1/stt, then the transcript is sent as text.',
        ]
      case 'anthropic':
        return [
          'Body: { model, messages, max_tokens: 4096, system? }',
          'messages[0].content is an array of text/image/document blocks.',
          'Images and documents use base64 source blocks with media_type.',
          'API headers include anthropic-version: 2023-06-01.',
        ]
      case 'gemini':
        return [
          'Body: { contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 4096 } }',
          'System prompt is inserted as a text part before the user message.',
          'Images, documents, audio, and video use inlineData with mimeType and base64 data.',
        ]
      case 'openrouter':
        return [
          'Body: { model, messages, max_tokens: 4096 } for most models.',
          'messages include optional system role and a user content array.',
          'Text uses { type: "text" }. Images use image_url data URLs. Documents use file_data.',
          'Audio uses { type: "input_audio", inputAudio: { data, format } } with base64 data.',
          'Audio-only runs on transcription-output models use /v1/audio/transcriptions instead of chat completions.',
        ]
      default:
        return [
          'Body: { model, messages, max_tokens: 4096 } for most models.',
          'o*, gpt-5*, and reasoning models use max_completion_tokens instead of max_tokens.',
          'messages include optional system role and a user content array.',
          'Text uses { type: "text" }. Images use image_url data URLs. Documents use file_data.',
        ]
    }
  })()

  const attachmentRules = [
    caps.requiresTextOnlyAttachments
      ? 'Text-only adapter: images, PDFs, DOCX, and other binary attachments are skipped before inference.'
      : 'Text attachments are embedded into the user text with filename delimiters.',
    caps.supportsImages && !caps.requiresTextOnlyAttachments
      ? 'Image attachments are sent to the provider adapter.'
      : 'Image attachments are skipped for this provider/model capability.',
    caps.supportsDocuments && !caps.requiresTextOnlyAttachments
      ? 'Document attachments are sent to the provider adapter.'
      : 'Document attachments are skipped for this provider/model capability.',
    caps.supportsAudio && !caps.requiresTextOnlyAttachments
      ? 'Audio attachments are sent to the provider adapter.'
      : 'Audio attachments are skipped for this provider/model capability.',
    caps.supportsVideo && !caps.requiresTextOnlyAttachments
      ? 'Video attachments are sent to the provider adapter.'
      : 'Video attachments are skipped for this provider/model capability.',
  ]

  if (adapter.id === 'openrouter') {
    attachmentRules.push('OpenRouter is treated as document-capable for PDFs through its universal PDF parsing path.')
    attachmentRules.push('OpenRouter image support is model-dependent; the app sends image_url for image-capable use, and provider rejection is marked skipped rather than retried with placeholders.')
    attachmentRules.push('OpenRouter audio support is model-dependent; the app sends base64 input_audio with the audio format inferred from the filename or MIME type.')
    attachmentRules.push('OpenRouter transcription-output models use the dedicated audio transcriptions endpoint for audio-only runs.')
  }
  if (adapter.id === 'xai') {
    attachmentRules.push('xAI always uses the Responses API in this app; PDFs are not sent through chat completions.')
    attachmentRules.push('xAI audio files are transcribed with the Grok STT REST endpoint before the transcript is sent to the response model.')
  }
  if (deepseekRouted.length > 0) {
    attachmentRules.push(`DeepSeek-routed model IDs are forced text-only: ${deepseekRouted.slice(0, 4).join(', ')}${deepseekRouted.length > 4 ? ', ...' : ''}.`)
  }

  return {
    adapter,
    endpoint,
    requestShape,
    attachmentRules,
    completionTokenModels,
    selected,
  }
}

export function ModelsTab() {
  const {
    config,
    modelScope, setModelScope, setModelScopes, toggleAllModels,
    modelPricing, setModelPricing, builtinPricing,
  } = useStore()
  const [expandedProv, setExpandedProv] = useState<Set<string>>(new Set())
  const [searches, setSearches] = useState<Record<string, string>>({})
  const [modalityFilters, setModalityFilters] = useState<Record<string, string | null>>({})
  const [capabilityFilters, setCapabilityFilters] = useState<Record<string, ModelCapability[] | ModelCapability | null>>({})
  const [sortModes, setSortModes] = useState<Record<string, ProviderModelSort>>({})
  const [handlingProvider, setHandlingProvider] = useState<ProviderConfig | null>(null)
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>([])
  const [activePresetId, setActivePresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presetStatus, setPresetStatus] = useState<string | null>(null)
  const [selectedModelSort, setSelectedModelSort] = useState<{ field: SelectedModelSortField; dir: 'asc' | 'desc' }>({ field: 'provider', dir: 'asc' })

  const enabledProviders = config.providers.filter((p: ProviderConfig) => p.enabled)

  useEffect(() => {
    webApi.getModelPresets()
      .then(data => setModelPresets(data.presets ?? []))
      .catch(err => setPresetStatus(`Could not load model presets: ${err.message ?? String(err)}`))
  }, [])

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
    const scoped = Object.entries(modelScope[providerId] ?? {})
      .filter(([, selected]) => selected)
      .map(([model]) => model)
    return Array.from(new Set([...models.filter(m => isModelSelected(providerId, m)), ...scoped])).sort()
  }

  function providerMatchesPresetModel(provider: ProviderConfig, presetModel: ModelPresetModel) {
    if (presetModel.providerId && provider.id === presetModel.providerId) return true
    if (provider.name === presetModel.providerName) return true
    return Boolean(presetModel.adapterId && provider.adapterId === presetModel.adapterId && provider.name.toLowerCase() === presetModel.providerName.toLowerCase())
  }

  function effectivePricing(provider: ProviderKeyInput | string, modelId: string): { input: number; output: number } {
    return resolveEffectivePricing(provider, modelId, modelPricing, builtinPricing)
  }

  function modelCapabilities(provider: ProviderConfig, model: string): ModelCapability[] {
    const meta = provider.modelMetas?.find((m: any) => m.id === model)
    return inferModelCapabilities(model, meta, effectivePricing(provider, model))
  }

  function normalizedCapabilityFilter(providerId: string): ModelCapability[] {
    const value = capabilityFilters[providerId]
    if (!value) return []
    return Array.isArray(value) ? value : [value]
  }

  function toggleCapabilityFilter(providerId: string, capability: ModelCapability) {
    setCapabilityFilters(current => {
      const active = normalizedCapabilityFilter(providerId)
      const next = active.includes(capability)
        ? active.filter(item => item !== capability)
        : [...active, capability]
      return { ...current, [providerId]: next }
    })
  }

  function selectedModelRows(): SelectedModelRow[] {
    return enabledProviders.flatMap((provider: ProviderConfig) =>
      getSelectedModels(provider.id, provider.models).map(model => ({
        provider,
        model,
        available: provider.models.includes(model),
        pricing: effectivePricing(provider, model),
        meta: provider.modelMetas?.find((m: any) => m.id === model),
      }))
    )
  }

  function sortSelectedModelRows(rows: SelectedModelRow[]) {
    const sign = selectedModelSort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (selectedModelSort.field) {
        case 'provider':
          cmp = a.provider.name.localeCompare(b.provider.name)
          break
        case 'model':
          cmp = a.model.localeCompare(b.model)
          break
        case 'input':
          cmp = (a.pricing.input || 0) - (b.pricing.input || 0)
          break
        case 'output':
          cmp = (a.pricing.output || 0) - (b.pricing.output || 0)
          break
      }
      if (cmp === 0) cmp = a.provider.name.localeCompare(b.provider.name) || a.model.localeCompare(b.model)
      return cmp * sign
    })
  }

  function toggleSelectedModelSort(field: SelectedModelSortField) {
    setSelectedModelSort(current => ({
      field,
      dir: current.field === field && current.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  function currentPresetModels(): ModelPresetModel[] {
    return selectedModelRows().map(row => ({
      providerId: row.provider.id,
      providerName: row.provider.name,
      adapterId: row.provider.adapterId,
      model: row.model,
    }))
  }

  function applyPreset(preset: ModelPreset) {
    const nextScope: Record<string, Record<string, boolean>> = {}
    for (const provider of enabledProviders) {
      const selected: Record<string, boolean> = {}
      for (const item of preset.models) {
        if (providerMatchesPresetModel(provider, item)) selected[item.model] = true
      }
      nextScope[provider.id] = selected
    }
    setModelScopes(nextScope)
    setActivePresetId(String(preset.id))
    setPresetName(preset.name)
    const missing = preset.models.filter(item => !enabledProviders.some((provider: ProviderConfig) => providerMatchesPresetModel(provider, item)))
    setPresetStatus(missing.length > 0 ? `${missing.length} preset model provider match${missing.length === 1 ? '' : 'es'} not found in enabled providers.` : null)
  }

  async function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) {
      setPresetStatus('Enter a preset name before saving.')
      return
    }
    const preset = await webApi.saveModelPreset({ name, models: currentPresetModels() })
    const data = await webApi.getModelPresets()
    setModelPresets(data.presets ?? [])
    setActivePresetId(String(preset.id))
    setPresetName(preset.name)
    setPresetStatus(`Saved preset "${preset.name}".`)
  }

  async function deleteActivePreset() {
    const preset = modelPresets.find(item => String(item.id) === activePresetId)
    if (!preset) return
    if (!confirm(`Delete model preset "${preset.name}"?`)) return
    await webApi.deleteModelPreset(preset.id)
    const data = await webApi.getModelPresets()
    setModelPresets(data.presets ?? [])
    setActivePresetId('')
    setPresetName('')
    setPresetStatus(`Deleted preset "${preset.name}".`)
  }

  const SORT_CYCLE: ProviderModelSort[] = [
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

  function sortedModels(providerId: string, provider: ProviderKeyInput, models: string[]): string[] {
    const sort = sortModes[provider.name ?? providerId] || 'name-asc'
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
    return [...models].sort((a, b) => {
      if (field === 'input') return (effectivePricing(provider, a).input - effectivePricing(provider, b).input) * sign
      if (field === 'output') return (effectivePricing(provider, a).output - effectivePricing(provider, b).output) * sign
      return a.localeCompare(b) * sign
    })
  }

  function filteredModels(providerId: string, models: string[]): string[] {
    const q = (searches[providerId] || '').toLowerCase()
    const scopedMissing = Object.entries(modelScope[providerId] ?? {})
      .filter(([model, selected]) => selected && !models.includes(model))
      .map(([model]) => model)
    const allModels = Array.from(new Set([...models, ...scopedMissing]))
    let list = q ? allModels.filter(m => m.toLowerCase().includes(q)) : allModels
    const modFilter = modalityFilters[providerId]
    if (modFilter) {
      const prov = config.providers.find((p: ProviderConfig) => p.id === providerId)
      const metas = prov?.modelMetas || []
      const [direction, modality] = modFilter.includes(':') ? modFilter.split(':') : ['legacy', modFilter]
      const modModelIds = new Set(metas.filter((m: any) => {
        if (direction === 'in') return (m.inputModalities || []).includes(modality)
        if (direction === 'out') return (m.outputModalities || []).includes(modality)
        return m.modality?.includes(modality)
      }).map((m: any) => m.id))
      list = list.filter(m => modModelIds.has(m) || scopedMissing.includes(m))
    }
    const activeCapabilities = normalizedCapabilityFilter(providerId)
    if (activeCapabilities.length > 0) {
      const prov = config.providers.find((p: ProviderConfig) => p.id === providerId)
      if (prov) {
        list = list.filter(model => {
          const caps = modelCapabilities(prov, model)
          return activeCapabilities.some(cap => caps.includes(cap))
        })
      }
    }
    return list
  }

  function updateModelPrice(provider: ProviderKeyInput, modelId: string, input: number, output: number) {
    const providerKey = canonicalProviderKey(provider)
    setModelPricing(`${providerKey}/${modelId}`, input, output)
    webApi.savePricing({
      serviceProvider: providerKey,
      modelId,
      input,
      output,
      displayName: modelId,
    }).catch(err => console.error('Failed to save model pricing', err))
  }

  const selectedRows = selectedModelRows()
  const sortedSelectedRows = sortSelectedModelRows(selectedRows)

  function SelectedModelHeader({ field, children, className = '' }: { field: SelectedModelSortField; children: ReactNode; className?: string }) {
    const active = selectedModelSort.field === field
    return (
      <th className={`px-4 py-2 font-medium ${className}`}>
        <button
          type="button"
          onClick={() => toggleSelectedModelSort(field)}
          className={`inline-flex items-center gap-1 hover:text-surface-200 ${className.includes('text-right') ? 'justify-end' : ''}`}
        >
          <span>{children}</span>
          {active ? (
            selectedModelSort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
          ) : (
            <ArrowUp size={12} className="opacity-0" />
          )}
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-bold text-surface-100">Models</h2>
        <p className="text-sm text-surface-400 mt-1">
          {enabledProviders.length} enabled provider{enabledProviders.length !== 1 ? 's' : ''} · {selectedRows.length} selected model{selectedRows.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="label">Model Preset</label>
            <div className="flex gap-2">
              <select
                className="input text-sm"
                value={activePresetId}
                onChange={e => {
                  const id = e.target.value
                  if (!id) {
                    setActivePresetId('')
                    setPresetName('')
                    setPresetStatus(null)
                    return
                  }
                  const preset = modelPresets.find(item => String(item.id) === id)
                  if (preset) applyPreset(preset)
                }}
              >
                <option value="">Select a preset...</option>
                {modelPresets.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
              <button
                onClick={deleteActivePreset}
                disabled={!activePresetId}
                className="rounded-md border border-surface-600 px-2 text-surface-400 transition-colors hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete selected preset"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="min-w-64 flex-1">
            <label className="label">Preset Name</label>
            <input
              className="input text-sm"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder="e.g. Audio transcription sweep"
            />
          </div>
          <button
            onClick={() => saveCurrentPreset().catch(err => setPresetStatus(`Save failed: ${err.message ?? String(err)}`))}
            className="btn-primary h-10"
          >
            Save Preset
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-surface-400">
          <span>{selectedRows.length} selected model{selectedRows.length !== 1 ? 's' : ''}</span>
          {presetStatus && <span className={presetStatus.includes('failed') || presetStatus.includes('not found') ? 'text-red-300' : 'text-brand-gold'}>{presetStatus}</span>}
        </div>
      </div>

      <div className="space-y-3">
        {enabledProviders.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-400">No enabled providers</p>
            <p className="text-surface-500 text-sm mt-1">Configure and enable providers in the Configure tab</p>
          </div>
        ) : (
          enabledProviders.map((prov: ProviderConfig) => {
            const selectedCount = getSelectedModels(prov.id, prov.models).length
            const isExpanded = expandedProv.has(prov.id)
            const search = searches[prov.id] || ''
            const scopedMissing = Object.entries(modelScope[prov.id] ?? {})
              .filter(([model, selected]) => selected && !prov.models.includes(model))
              .map(([model]) => model)
            const totalVisibleSourceModels = Array.from(new Set([...prov.models, ...scopedMissing]))
            const availableCapabilities = Array.from(new Set(totalVisibleSourceModels.flatMap(model => modelCapabilities(prov, model))))
            const activeCapabilities = normalizedCapabilityFilter(prov.id)
            const displayModels = sortedModels(prov.id, prov, filteredModels(prov.id, prov.models))
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
                  <button
                    onClick={e => { e.stopPropagation(); setHandlingProvider(prov) }}
                    className="rounded-md border border-surface-600 px-2 py-1 text-[10px] font-medium text-surface-300 transition-colors hover:border-brand-gold/50 hover:text-brand-gold"
                  >
                    Handling
                  </button>

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
                          if (sm === 'active') return <><span className="text-brand-gold">Active</span></>
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
                  <div className="border-t border-surface-700">
                    <div className="space-y-2 border-b border-surface-800 px-3 py-3">
                      {(() => {
                        const filters = new Map<string, string>()
                        for (const m of (prov.modelMetas || [])) {
                          for (const mod of (m.inputModalities || [])) {
                            if (mod && mod !== 'text') filters.set(`in:${mod}`, `${mod === 'image' ? 'Image' : mod.charAt(0).toUpperCase() + mod.slice(1)} In`)
                          }
                          for (const mod of (m.outputModalities || [])) {
                            if (mod && mod !== 'text') filters.set(`out:${mod}`, `${mod === 'transcription' ? 'Transcription' : mod.charAt(0).toUpperCase() + mod.slice(1)} Out`)
                          }
                          if (!m.inputModalities && !m.outputModalities && m.modality) {
                            m.modality.split('+').forEach((x: string) => {
                              const mod = x.trim()
                              if (mod !== 'text') filters.set(mod, mod === 'image' ? 'Vision' : mod)
                            })
                          }
                        }
                        if (filters.size === 0) return null
                        const activeMod = modalityFilters[prov.id]
                        const modColors: Record<string, string> = {
                          image: 'bg-brand-gold/15 text-brand-gold border-brand-gold/40 active:bg-brand-gold/30',
                          'in:image': 'bg-brand-gold/15 text-brand-gold border-brand-gold/40 active:bg-brand-gold/30',
                          'in:audio': 'bg-brand-blue/15 text-brand-blue border-brand-blue/40 dark:text-brand-gold',
                          'out:transcription': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
                          text: 'bg-brand-blue/15 text-brand-blue border-brand-blue/40 active:bg-brand-blue/30 dark:text-brand-gold',
                        }
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-surface-400">Modality</span>
                            {Array.from(filters.entries()).map(([mod, label]) => (
                              <button
                                key={mod}
                                onClick={e => { e.stopPropagation(); setModalityFilters(s => ({ ...s, [prov.id]: activeMod === mod ? null : mod })) }}
                                className={`text-xs shrink-0 rounded-full px-2.5 py-0.5 border transition-all font-medium ${
                                  activeMod === mod
                                    ? (modColors[mod] || 'bg-brand-blue/15 text-brand-blue border-brand-blue/40 dark:text-brand-gold')
                                    : 'bg-transparent text-surface-500 border-surface-600 hover:text-surface-300 hover:border-surface-500'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-surface-400">Good for</span>
                        {availableCapabilities.map(cap => {
                          const active = activeCapabilities.includes(cap)
                          return (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => toggleCapabilityFilter(prov.id, cap)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                active ? CAPABILITY_STYLES[cap] : 'border-surface-700 bg-transparent text-surface-500 hover:border-surface-500 hover:text-surface-300'
                              }`}
                            >
                              {CAPABILITY_LABELS[cap]}
                            </button>
                          )
                        })}
                      </div>
                      <div className="text-[10px] text-surface-500">
                        {displayModels.length} of {totalVisibleSourceModels.length} showing · inferred guidance
                      </div>
                    </div>
                    <div className="p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-80 overflow-y-auto">
                      {displayModels.length === 0 ? (
                        <div className="col-span-full text-center py-4 text-xs text-surface-500">No models match "{search}"</div>
                      ) : (
                        displayModels.map((model: string) => {
                          const selected = isModelSelected(prov.id, model)
                          const missing = !prov.models.includes(model)
                          const meta = prov.modelMetas?.find((m: any) => m.id === model)
                          const pricing = effectivePricing(prov, model)
                          const capabilities = modelCapabilities(prov, model)
                          return (
                          <div
                            key={model}
                            className={`rounded-lg border p-3 transition-all ${
                              missing
                                ? 'bg-red-950/25 border-red-700/60'
                                : selected
                                ? 'bg-brand-blue/10 border-brand-blue/40 hover:bg-brand-blue/20 dark:bg-brand-gold/10 dark:border-brand-gold/40'
                                : 'bg-surface-850 border-surface-700 opacity-50 hover:opacity-80'
                            }`}
                          >
                            <div
                              onClick={() => setModelScope(prov.id, model, !selected)}
                              className="cursor-pointer"
                            >
                              <div className="flex items-start justify-between mb-1">
                                <span className={`text-xs font-mono font-medium leading-tight truncate ${selected ? 'text-brand-blue dark:text-brand-gold' : 'text-surface-400'}`} title={model}>
                                  {model.length > 28 ? model.slice(0, 26) + '...' : model}
                                </span>
                                {selected ? (
                                  <ToggleRight size={16} className="text-brand-gold shrink-0" />
                                ) : (
                                  <ToggleLeft size={16} className="text-surface-500 shrink-0" />
                                )}
                              </div>
                              <div className="text-[10px] text-surface-500 space-y-0.5">
                                {missing && <p className="font-semibold text-red-300">Missing from provider model list</p>}
                                {meta?.owned_by && <p>by {meta.owned_by}</p>}
                                {meta?.context_length && <p>ctx: {(meta.context_length / 1000).toFixed(0)}k</p>}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {capabilities.map(cap => (
                                  <span
                                    key={cap}
                                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${CAPABILITY_STYLES[cap]}`}
                                  >
                                    {CAPABILITY_LABELS[cap]}
                                  </span>
                                ))}
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
                                  onChange={e => updateModelPrice(prov, model, parseFloat(e.target.value) || 0, pricing.output)}
                                  className="w-full bg-surface-800 border border-surface-600 rounded text-[10px] px-1 py-0.5 text-surface-100 focus:outline-none focus:ring-1 focus:ring-brand-gold"
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
                                  onChange={e => updateModelPrice(prov, model, pricing.input, parseFloat(e.target.value) || 0)}
                                  className="w-full bg-surface-800 border border-surface-600 rounded text-[10px] px-1 py-0.5 text-surface-100 focus:outline-none focus:ring-1 focus:ring-brand-gold"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-surface-200">Selected Models</h3>
          <p className="text-xs text-surface-500">Current working set from presets or manual selection.</p>
        </div>
        {selectedRows.length === 0 ? (
          <div className="px-4 py-5 text-sm text-surface-500">No models selected.</div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-950 text-surface-400">
                <tr>
                  <SelectedModelHeader field="provider">Provider</SelectedModelHeader>
                  <SelectedModelHeader field="model">Model</SelectedModelHeader>
                  <SelectedModelHeader field="input" className="text-right">Input $/M</SelectedModelHeader>
                  <SelectedModelHeader field="output" className="text-right">Output $/M</SelectedModelHeader>
                </tr>
              </thead>
              <tbody>
                {sortedSelectedRows.map(row => (
                  <tr key={`${row.provider.id}:${row.model}`} className={`border-t border-surface-800 ${row.available ? 'text-surface-200' : 'bg-red-950/20 text-red-200'}`}>
                    <td className="px-4 py-2">{row.provider.name}</td>
                    <td className="px-4 py-2">
                      <div className="font-mono">{row.model}</div>
                      {!row.available && <span className="rounded border border-red-700/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">missing</span>}
                      {row.meta && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {row.meta.owned_by && <span className="text-[10px] text-surface-500">by {row.meta.owned_by}</span>}
                          {row.meta.context_length && <span className="text-[10px] text-surface-500">ctx {(row.meta.context_length / 1000).toFixed(0)}k</span>}
                          {(() => {
                            const caps = inferModelCapabilities(row.model, row.meta, row.pricing)
                            if (caps.length === 0) return null
                            return caps.map(cap => (
                              <span key={cap} className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${CAPABILITY_STYLES[cap]}`}>
                                {CAPABILITY_LABELS[cap]}
                              </span>
                            ))
                          })()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{row.pricing.input || 0}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.pricing.output || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {handlingProvider && (() => {
        const selectedModels = getSelectedModels(handlingProvider.id, handlingProvider.models)
        const handling = providerHandlingDetails(handlingProvider, selectedModels)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setHandlingProvider(null)}>
            <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-surface-700 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-surface-100">{handlingProvider.name} Handling</h3>
                  <p className="text-xs text-surface-500">{handling.selected.length} selected model{handling.selected.length !== 1 ? 's' : ''}</p>
                </div>
                <button onClick={() => setHandlingProvider(null)} className="rounded-md p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100">
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5 text-sm">
                <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">Adapter</dt>
                    <dd className="font-mono text-surface-200">{handling.adapter.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">Protocol</dt>
                    <dd className="text-surface-200">{handling.adapter.protocol}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">Endpoint</dt>
                    <dd className="font-mono text-surface-200 break-all">{handling.endpoint}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">API key env</dt>
                    <dd className="font-mono text-surface-200">{handlingProvider.apiKeyEnv}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">Headers</dt>
                    <dd className="font-mono text-surface-200 whitespace-pre-wrap">{handlingProvider.headers?.trim() || 'None'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-surface-500">Pricing key</dt>
                    <dd className="font-mono text-surface-200">{canonicalProviderKey(handlingProvider)}</dd>
                  </div>
                </dl>

                <div>
                  <h4 className="mb-2 font-semibold text-surface-200">Request Shape</h4>
                  <ul className="space-y-1 text-xs text-surface-400">
                    {handling.requestShape.map((item, idx) => <li key={idx}>{item}</li>)}
                  </ul>
                </div>

                <div>
                  <h4 className="mb-2 font-semibold text-surface-200">Attachment Rules</h4>
                  <ul className="space-y-1 text-xs text-surface-400">
                    {handling.attachmentRules.map((item, idx) => <li key={idx}>{item}</li>)}
                  </ul>
                </div>

                {handling.completionTokenModels.length > 0 && (
                  <div className="rounded-lg border border-brand-gold/30 bg-brand-gold/10 p-3">
                    <h4 className="mb-1 font-semibold text-brand-gold">Completion-token parameter models</h4>
                    <p className="text-xs text-surface-300">
                      These selected models use <span className="font-mono">max_completion_tokens</span>: {handling.completionTokenModels.slice(0, 8).join(', ')}
                      {handling.completionTokenModels.length > 8 ? ', ...' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
