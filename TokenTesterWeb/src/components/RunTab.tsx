import { useState } from 'react'
import { Play, Square, Loader2, CheckCircle, XCircle, Clock, Trash2, ChevronRight, ChevronDown, ChevronLeft, ToggleLeft, ToggleRight, Search, Copy, X, Check, ArrowUp, ArrowDown, List, FileText, RotateCcw } from 'lucide-react'
import { useStore } from '../store'
import type { AttachedFile, DebugEntry, FileItem, TestRun } from '../types'
import { estimateCost, formatDuration, truncate } from '../utils/formatters'
import { webApi } from '../lib/web-api'
import { canonicalProviderKey, effectivePricing as resolveEffectivePricing, pricingLookupKeys, type ProviderKeyInput } from '../lib/provider-key'
import { buildRunInput, filesForRun, unsupportedAttachmentReason } from '../lib/run-input'
import { getAttachmentCapabilities, getProviderAdapter } from '../lib/provider-registry'
import { ResponseRenderer, responseDisplayValue } from './ResponseRenderer'

function modelLozenges(providerName: string, modelId: string, meta: any, pricing: { input: number; output: number }) {
  const id = modelId.toLowerCase()
  const provider = providerName.toLowerCase()
  const tags: { label: string; tone: 'blue' | 'gold' | 'slate' | 'green' }[] = []
  const add = (label: string, tone: 'blue' | 'gold' | 'slate' | 'green' = 'slate') => {
    if (!tags.some(t => t.label === label)) tags.push({ label, tone })
  }

  if (meta?.modality?.includes('image') || /vision|image|vl|omni|gpt-4o|gemini/.test(id)) add('Vision', 'gold')
  if (/code|coder|coding|codestral|devstral|grok-build|deepseek-coder|qwen.*coder/.test(id)) add('Coding', 'blue')
  if (/reason|thinking|r1|o\d|grok-4|sonnet|opus/.test(id)) add('Reasoning', 'gold')
  if (/mini|small|haiku|flash|fast|instant|lite|8b|7b/.test(id)) add('Fast', 'green')
  if (/cheap|free|mini|small|haiku|flash|lite/.test(id) || (pricing.input > 0 && pricing.output > 0 && pricing.input <= 1 && pricing.output <= 3)) add('Low cost', 'green')
  if ((meta?.context_length ?? 0) >= 128000 || /128k|200k|256k|1m|long/.test(id)) add('Long ctx', 'blue')
  if (/embed/.test(id)) add('Embeddings', 'slate')
  if (/image|imagine|dall|stable|flux/.test(id)) add('Image gen', 'gold')
  if (provider.includes('openrouter') && id.includes('/')) add('Routed', 'slate')
  if (tags.length === 0) add('General', 'slate')

  return tags.slice(0, 4)
}

function lozengeClass(tone: 'blue' | 'gold' | 'slate' | 'green') {
  switch (tone) {
    case 'blue':
      return 'border-brand-blue/35 bg-brand-blue/10 text-brand-blue dark:border-brand-blue/50 dark:bg-brand-blue/15 dark:text-surface-100'
    case 'gold':
      return 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold'
    case 'green':
      return 'border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300'
    default:
      return 'border-surface-600 bg-surface-800 text-surface-400'
  }
}

function fileKey(file: AttachedFile | null | undefined) {
  if (!file) return ''
  return [
    file.path || file.name,
    file.size,
    file.ext,
    file.type,
  ].join(':')
}

function runIdentityKey(run: Pick<TestRun, 'providerId' | 'model' | 'sourceType' | 'systemPrompt' | 'userMessage' | 'file' | 'batchFiles'>) {
  const batchKey = (run.batchFiles ?? []).map(fileKey).sort().join('|')
  return [
    run.providerId,
    run.model,
    run.sourceType,
    run.systemPrompt,
    run.userMessage,
    fileKey(run.file),
    batchKey,
  ].join('||')
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function hashableFileContent(file: AttachedFile) {
  return file.base64 || file.content || JSON.stringify({
    name: file.name,
    path: file.path,
    size: file.size,
    ext: file.ext,
    type: file.type,
    mimeType: file.mimeType,
    metadata: file.metadata ?? null,
  })
}

interface PayloadMediaSummary {
  pdfSent: boolean
  pdfFileSize: number | null
  imageSent: boolean
  imageFileSize: number | null
  videoSent: boolean
  videoFileSize: number | null
  audioSent: boolean
  audioFileSize: number | null
}

const EMPTY_PAYLOAD_MEDIA: PayloadMediaSummary = {
  pdfSent: false,
  pdfFileSize: null,
  imageSent: false,
  imageFileSize: null,
  videoSent: false,
  videoFileSize: null,
  audioSent: false,
  audioFileSize: null,
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.mpeg', '.mpg', '.wmv', '.flv'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff'])

function payloadMediaSummary(files: AttachedFile[]): PayloadMediaSummary {
  const summary = { ...EMPTY_PAYLOAD_MEDIA }
  for (const file of files) {
    const size = Number.isFinite(file.size) ? file.size : 0
    const ext = (file.ext || '').toLowerCase()
    const mimeType = (file.mimeType || '').toLowerCase()

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      summary.pdfSent = true
      summary.pdfFileSize = (summary.pdfFileSize ?? 0) + size
    } else if (file.type === 'image' || mimeType.startsWith('image/')) {
      summary.imageSent = true
      summary.imageFileSize = (summary.imageFileSize ?? 0) + size
    } else if (mimeType.startsWith('video/') || VIDEO_EXTS.has(ext)) {
      summary.videoSent = true
      summary.videoFileSize = (summary.videoFileSize ?? 0) + size
    } else if (mimeType.startsWith('audio/') || AUDIO_EXTS.has(ext)) {
      summary.audioSent = true
      summary.audioFileSize = (summary.audioFileSize ?? 0) + size
    }
  }
  return summary
}

function usesCompletionTokensParam(model: string) {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model) || model.toLowerCase().includes('reasoning')
}

function providerHandlingDetails(provider: any, selectedModels: string[]) {
  const adapter = getProviderAdapter(provider)
  const caps = getAttachmentCapabilities(provider)
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '') || ''
  const selected = selectedModels.length > 0 ? selectedModels : provider.models ?? []
  const deepseekRouted = selected.filter((model: string) => model.toLowerCase().includes('deepseek'))
  const completionTokenModels = selected.filter(usesCompletionTokensParam)

  const endpoint = (() => {
    switch (adapter.id) {
      case 'xai': return `${baseUrl}/v1/responses`
      case 'anthropic': return 'https://api.anthropic.com/v1/messages'
      case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
      default: return `${baseUrl}/v1/chat/completions`
    }
  })()

  const requestShape = (() => {
    switch (adapter.id) {
      case 'xai':
        return [
          'Body: { model, input, max_output_tokens: 4096 }',
          'input contains optional system message plus user content parts.',
          'Text uses input_text. Images use input_image with data URLs.',
          'Documents are uploaded first to /v1/files, then referenced as input_file by file_id.',
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
  }
  if (adapter.id === 'xai') {
    attachmentRules.push('xAI always uses the Responses API in this app; PDFs are not sent through chat completions.')
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

export function RunTab() {
  const {
    config, systemPrompt, customPrompts, fileItems,
    queue, setQueue, updateRun, clearQueue,
    isRunning, setIsRunning, setActiveTab,
    modelScope, setModelScope, toggleAllModels,
    modelPricing, setModelPricing, builtinPricing,
    debugEntries, pushDebugEntry, removeDebugEntry, clearDebugEntries,
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
  const [hideFailedOutput, setHideFailedOutput] = useState(false)
  const [requestCollapsed, setRequestCollapsed] = useState(true)
  const [handlingProvider, setHandlingProvider] = useState<any | null>(null)

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
    const sorted = [...models].sort((a, b) => {
      if (field === 'input') {
        return (effectivePricing(provider, a).input - effectivePricing(provider, b).input) * sign
      }
      if (field === 'output') {
        return (effectivePricing(provider, a).output - effectivePricing(provider, b).output) * sign
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

  function effectivePricing(provider: ProviderKeyInput | string, modelId: string): { input: number; output: number } {
    return resolveEffectivePricing(provider, modelId, modelPricing, builtinPricing)
  }

  async function archiveRun(run: TestRun, status: TestRun['status'], result: NonNullable<TestRun['result']>, localInputTokens?: number, payloadMedia: PayloadMediaSummary = EMPTY_PAYLOAD_MEDIA) {
    try {
      const files = run.batchFiles?.length ? run.batchFiles : (run.file ? [run.file] : [])
      const fileHashes = await Promise.all(files.map(async file => ({
        name: file.name,
        path: file.path,
        size: file.size,
        type: file.type,
        mimeType: file.mimeType,
        hash: await sha256Hex(hashableFileContent(file)),
        metadata: file.metadata ?? null,
      })))
      const systemPromptHash = await sha256Hex(run.systemPrompt || '')
      const userMessageHash = await sha256Hex(run.userMessage || '')
      const inputHash = await sha256Hex(JSON.stringify({
        systemPromptHash,
        userMessageHash,
        files: fileHashes.map(file => file.hash),
      }))
      const rate = run.priceOverride && (run.priceOverride.input > 0 || run.priceOverride.output > 0)
        ? { ...run.priceOverride, per: '1M' }
        : { ...effectivePricing(run.providerName, run.model), per: '1M' }
      const serviceProvider = canonicalProviderKey(run.providerName)
      const recordKey = `${serviceProvider}|${run.model}|${inputHash}`

      await webApi.saveArchivedResult({
        runId: `${run.id}:${crypto.randomUUID()}`,
        recordKey,
        status,
        providerId: run.providerId,
        providerName: run.providerName,
        serviceProvider,
        model: run.model,
        sourceType: run.sourceType,
        sourceLabel: run.sourceLabel,
        systemPrompt: run.systemPrompt,
        systemPromptHash,
        userMessage: run.userMessage,
        userMessageHash,
        inputHash,
        fileName: run.file?.name ?? (run.batchFiles ? `batch (${run.batchFiles.length})` : null),
        filePath: run.file?.path ?? null,
        fileSize: run.file?.size ?? (run.batchFiles ? run.batchFiles.reduce((sum, file) => sum + file.size, 0) : null),
        fileType: run.file?.type ?? (run.batchFiles ? 'batch' : null),
        fileMimeType: run.file?.mimeType ?? null,
        fileHash: fileHashes.length === 1 ? fileHashes[0].hash : fileHashes.length > 1 ? await sha256Hex(fileHashes.map(file => file.hash).join('|')) : null,
        fileMetadata: run.file?.metadata ?? null,
        batchFiles: run.batchFiles ? fileHashes : null,
        pdfSent: payloadMedia.pdfSent,
        pdfFileSize: payloadMedia.pdfFileSize,
        imageSent: payloadMedia.imageSent,
        imageFileSize: payloadMedia.imageFileSize,
        videoSent: payloadMedia.videoSent,
        videoFileSize: payloadMedia.videoFileSize,
        audioSent: payloadMedia.audioSent,
        audioFileSize: payloadMedia.audioFileSize,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        localInputTokens: localInputTokens ?? null,
        latencyMs: result.latencyMs,
        inputPricePer1m: rate.input,
        outputPricePer1m: rate.output,
        estimatedCost: estimateCost(result.inputTokens, result.outputTokens, rate),
        responseText: result.responseText,
        error: result.error,
        requestPayload: result.requestPayload,
        responsePayload: result,
        runStartedAt: run.timestamp,
      })
    } catch (err) {
      console.error('Failed to archive run result', err)
    }
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

    const existingKeys = new Set(queue.map(runIdentityKey))
    const runs: TestRun[] = [...queue]
    for (const prov of enabledProviders) {
      const selected = getSelectedModels(prov.id, prov.models)
      for (const model of selected) {
        for (const tc of testCases) {
          const run: TestRun = {
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
            priceOverride: pricingLookupKeys(prov, model)
              .map(key => modelPricing[key])
              .find(price => price && (price.input > 0 || price.output > 0)),
          }
          const key = runIdentityKey(run)
          if (!existingKeys.has(key)) {
            existingKeys.add(key)
            runs.push(run)
          }
        }
      }
    }
    setQueue(runs)
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

  async function executeRun(run: TestRun) {
    updateRun(run.id, { status: 'running', result: undefined, localInputTokens: undefined })
    let sentMedia = EMPTY_PAYLOAD_MEDIA

    const prov = config.providers.find((p: any) => p.id === run.providerId)
    if (!prov) {
      updateRun(run.id, { status: 'error', result: { inputTokens: 0, outputTokens: 0, totalTokens: 0, responseText: '', latencyMs: 0, error: 'Provider not found' } })
      setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
      return
    }

    const skipReason = unsupportedAttachmentReason(prov, run)
    if (skipReason) {
      const skippedResult = { inputTokens: 0, outputTokens: 0, totalTokens: 0, responseText: '', latencyMs: 0, error: skipReason }
      updateRun(run.id, {
        status: 'skipped',
        result: skippedResult,
      })
      pushDebugEntry({
        runId: run.id,
        provider: prov.name,
        model: run.model,
        request: { skipped: true, reason: skipReason },
        response: skippedResult,
        error: skipReason,
        file: run.file?.name || (run.batchFiles ? `batch (${run.batchFiles.length})` : ''),
        filePath: run.file?.path,
        inputTokens: 0,
        outputTokens: 0,
        latency: 0,
      })
      await archiveRun(run, 'skipped', skippedResult)
      setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
      return
    }

    try {
      const input = buildRunInput(run)
      sentMedia = payloadMediaSummary(filesForRun(run))

      let result = await webApi.chatCompletion({
        provider: { type: prov.type, adapterId: prov.adapterId, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers },
        model: run.model,
        input,
        maxTokens: 4096,
      })

      if (result.error && /max_tokens.*max_completion_tokens/i.test(result.error)) {
        result = await webApi.chatCompletion({
          provider: { type: prov.type, adapterId: prov.adapterId, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers },
          model: run.model,
          input,
          maxTokens: 4096,
        })
      }

      if (result.error && /invalid.*(mime|image|format)|file.*data.*missing|unknown variant.*(image_url|file)|expected `text`/i.test(result.error)) {
        const skippedResult = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          responseText: '',
          latencyMs: 0,
          error: `${prov.name} rejected the attachment for ${run.model}; skipped instead of retrying with a placeholder.`,
          requestPayload: result.requestPayload,
        }
        updateRun(run.id, {
          status: 'skipped',
          result: skippedResult,
          localInputTokens: undefined,
        })
        pushDebugEntry({
          runId: run.id,
          provider: prov.name,
          model: run.model,
          request: result.requestPayload ?? input,
          response: skippedResult,
          error: skippedResult.error,
          file: run.file?.name || (run.batchFiles ? `batch (${run.batchFiles.length})` : ''),
          filePath: run.file?.path,
          inputTokens: 0,
          outputTokens: 0,
          latency: 0,
        })
        await archiveRun(run, 'skipped', skippedResult, undefined, sentMedia)
        setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
        return
      }

      const debug: DebugEntry = {
        runId: run.id,
        provider: prov.name,
        model: run.model,
        request: result.requestPayload ?? input,
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
        const fullText = [
          input.systemPrompt,
          input.userMessage,
          ...input.attachments.map(file => file.text || file.filename),
        ].join(' ')
        localTokens = await webApi.countTokens(fullText)
      } catch { /* ignore */ }

      const status = result.error ? 'error' : 'success'
      updateRun(run.id, {
        status,
        result,
        localInputTokens: localTokens || undefined,
      })
      await archiveRun(run, status, result, localTokens || undefined, sentMedia)
    } catch (err: any) {
      const errorResult = { inputTokens: 0, outputTokens: 0, totalTokens: 0, responseText: '', latencyMs: 0, error: err.message ?? String(err) }
      updateRun(run.id, {
        status: 'error',
        result: errorResult,
      })
      pushDebugEntry({
        runId: run.id,
        provider: prov.name,
        model: run.model,
        request: { failedBeforeProviderResponse: true },
        response: errorResult,
        error: errorResult.error,
        file: run.file?.name || (run.batchFiles ? `batch (${run.batchFiles.length})` : ''),
        filePath: run.file?.path,
        inputTokens: 0,
        outputTokens: 0,
        latency: 0,
      })
      await archiveRun(run, 'error', errorResult, undefined, sentMedia)
    }

    setProgress((p: any) => ({ ...p, completed: p.completed + 1 }))
  }

  async function runAll() {
    if (queue.length === 0) return
    const pendingRuns = queue.filter((r: TestRun) => r.status === 'queued')
    if (pendingRuns.length === 0) return
    setIsRunning(true)
    setProgress({ completed: 0, total: pendingRuns.length })

    for (let i = 0; i < pendingRuns.length; i++) {
      const run = pendingRuns[i]
      if (!useStore.getState().isRunning) break
      await executeRun(run)
    }

    setIsRunning(false)
  }

  async function retryRun(run: TestRun) {
    if (isRunning || run.status === 'running') return
    setIsRunning(true)
    setProgress({ completed: 0, total: 1 })
    await executeRun(run)
    setIsRunning(false)
  }

  function removeRun(id: string) {
    setQueue(queue.filter((r: TestRun) => r.id !== id))
    removeDebugEntry(id)
  }

  function clearRuns() {
    clearQueue()
    clearDebugEntries()
    setProgress({ completed: 0, total: 0 })
    setOutputIndex(0)
  }

  function stopRun() { setIsRunning(false) }

  function copyDebug(json: string, idx: number) {
    navigator.clipboard.writeText(json)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  const successCount = queue.filter((r: any) => r.status === 'success').length
  const errorCount = queue.filter((r: any) => r.status === 'error').length
  const skippedCount = queue.filter((r: any) => r.status === 'skipped').length
  const queuedCount = queue.filter((r: any) => r.status === 'queued').length

  const filteredDebugEntries = debugEntries.filter(e =>
    (filterModel ? e.model === filterModel : true) &&
    (filterFile ? e.file === filterFile : true) &&
    (hideFailedOutput ? !e.error : true)
  )
  const uniqueModels = [...new Set(debugEntries.map(e => e.model))]
  const uniqueFiles = [...new Set(debugEntries.map(e => e.file).filter(Boolean) as string[])]
  const displayIndex = filteredDebugEntries.length > 0
    ? Math.min(outputIndex, filteredDebugEntries.length - 1)
    : 0
  const displayEntry = filteredDebugEntries.length > 0 ? filteredDebugEntries[displayIndex] : null

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
              className="bg-brand-gold h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center border-b border-surface-700 mb-4 shrink-0">
        <button
          onClick={() => setSubTab('queue')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            subTab === 'queue' ? 'border-brand-gold text-surface-100' : 'border-transparent text-surface-400 hover:text-surface-200'
          }`}
        >
          <List size={14} className="inline mr-1.5" />Queue
        </button>
        <button
          onClick={() => { setSubTab('output'); setOutputIndex(0) }}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            subTab === 'output' ? 'border-brand-gold text-surface-100' : 'border-transparent text-surface-400 hover:text-surface-200'
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
                <button onClick={runAll} disabled={queuedCount === 0} className="btn-success flex items-center gap-1.5">
                  <Play size={16} /> Run All ({queuedCount})
                </button>
              ) : (
                <button onClick={stopRun} className="btn-danger flex items-center gap-1.5">
                  <Square size={16} /> Stop
                </button>
              )}
              <button onClick={clearRuns} disabled={isRunning} className="btn-danger flex items-center gap-1.5">
                <Trash2 size={16} /> Clear
              </button>
            </div>
          </div>

          {successCount + errorCount + skippedCount > 0 && (
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
                <Clock size={18} className={skippedCount > 0 ? 'text-surface-400' : 'text-surface-500'} />
                <span className="text-sm text-surface-200">{skippedCount} skipped</span>
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
                          {(() => {
                            const modalities = new Set<string>()
                            for (const m of (prov.modelMetas || [])) {
                              if (m.modality) m.modality.split('+').forEach((x: string) => { if (x.trim() !== 'text') modalities.add(x.trim()) })
                            }
                            const activeMod = modalityFilters[prov.id]
                            const modColors: Record<string, string> = {
                              image: 'bg-brand-gold/15 text-brand-gold border-brand-gold/40 active:bg-brand-gold/30',
                              text: 'bg-brand-blue/15 text-brand-blue border-brand-blue/40 active:bg-brand-blue/30 dark:text-brand-gold',
                            }
                            return Array.from(modalities).map(mod => (
                              <button
                                key={mod}
                                onClick={e => { e.stopPropagation(); setModalityFilters(s => ({ ...s, [prov.id]: activeMod === mod ? null : mod })) }}
                                className={`text-xs shrink-0 rounded-full px-2.5 py-0.5 border transition-all font-medium ${
                                  activeMod === mod
                                    ? (modColors[mod] || 'bg-brand-blue/15 text-brand-blue border-brand-blue/40 dark:text-brand-gold')
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
                            const pricing = effectivePricing(prov, model)
                            const lozenges = modelLozenges(prov.name, model, meta, pricing)
                            return (
                              <div
                                key={model}
                                className={`rounded-lg border p-3 transition-all ${
                                  selected
                                    ? 'bg-brand-blue/10 border-brand-blue/40 hover:bg-brand-blue/20 dark:bg-brand-gold/10 dark:border-brand-gold/40'
                                    : 'bg-surface-850 border-surface-700 opacity-50 hover:opacity-80'
                                }`}
                              >
                                <div
                                  onClick={() => setModelScope(prov.id, model, !selected)}
                                  className="cursor-pointer"
                                >
                                  <div className="flex items-start justify-between mb-1">
                                    <span className={`text-xs font-mono font-medium leading-tight ${selected ? 'text-brand-blue dark:text-brand-gold' : 'text-surface-400'}`}>
                                      {model.length > 28 ? model.slice(0, 26) + '…' : model}
                                    </span>
                                    {selected ? (
                                      <ToggleRight size={16} className="text-brand-gold shrink-0" />
                                    ) : (
                                      <ToggleLeft size={16} className="text-surface-500 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-[10px] text-surface-500 space-y-0.5">
                                    {meta?.owned_by && <p>by {meta.owned_by}</p>}
                                    {meta?.context_length && <p>ctx: {(meta.context_length / 1000).toFixed(0)}k</p>}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {lozenges.map(tag => (
                                      <span
                                        key={tag.label}
                                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${lozengeClass(tag.tone)}`}
                                      >
                                        {tag.label}
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
                    {run.status === 'running' && <Loader2 size={14} className="text-brand-gold animate-spin shrink-0" />}
                    {run.status === 'success' && <CheckCircle size={14} className="text-emerald-400 shrink-0" />}
                    {run.status === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                    {run.status === 'skipped' && <Clock size={14} className="text-surface-400 shrink-0" />}
                    <span className="text-xs font-mono text-brand-gold w-20 shrink-0 truncate">{run.providerName}</span>
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
                      <span className={`text-xs truncate max-w-[150px] shrink-0 ${run.status === 'skipped' ? 'text-surface-400' : 'text-red-400'}`} title={run.result.error}>
                        {truncate(run.result.error, 40)}
                      </span>
                    )}
                    {run.status === 'error' && (
                      <button
                        onClick={() => retryRun(run)}
                        disabled={isRunning}
                        className="inline-flex items-center gap-1 rounded-md border border-brand-blue/35 bg-brand-blue/10 px-2 py-1 text-[10px] font-medium text-brand-blue transition-colors hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-40 dark:border-brand-gold/35 dark:bg-brand-gold/10 dark:text-brand-gold dark:hover:bg-brand-gold/20"
                        title="Retry this failed task"
                      >
                        <RotateCcw size={12} />
                        Retry
                      </button>
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
                  <span className="text-[10px] text-surface-500">
                    {displayEntry ? (displayEntry.error ? 'Error' : 'Success') : '-'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setHideFailedOutput(value => !value)
                      setOutputIndex(0)
                    }}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                      hideFailedOutput
                        ? 'border-brand-gold/45 bg-brand-gold/15 text-brand-gold'
                        : 'border-surface-700 bg-surface-850 text-surface-400 hover:border-surface-600 hover:text-surface-200'
                    }`}
                    title="Hide failed output records from the page flipper"
                  >
                    {hideFailedOutput ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    Hide Failed
                  </button>
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
                        <div className="max-h-[500px] overflow-y-auto">
                          <ResponseRenderer value={responseDisplayValue(displayEntry.response)} />
                        </div>
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
      {handlingProvider && (() => {
        const selectedModels = getSelectedModels(handlingProvider.id, handlingProvider.models)
        const handling = providerHandlingDetails(handlingProvider, selectedModels)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setHandlingProvider(null)}>
            <div className="max-h-[86vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-surface-700 bg-surface-950 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-surface-700 bg-surface-950 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-surface-100">{handlingProvider.name} Handling</h3>
                  <p className="mt-1 text-xs text-surface-400">
                    Adapter <span className="font-mono text-brand-gold">{handling.adapter.id}</span> · Protocol <span className="font-mono text-surface-200">{handling.adapter.protocol}</span> · Canonical pricing key <span className="font-mono text-surface-200">{handling.adapter.canonicalProviderKey}</span>
                  </p>
                </div>
                <button onClick={() => setHandlingProvider(null)} className="rounded-md p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-100">
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-4 p-5 lg:grid-cols-2">
                <section className="rounded-lg border border-surface-700 bg-surface-900 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-surface-200">API Route</h4>
                  <dl className="space-y-2 text-xs">
                    <div>
                      <dt className="text-surface-500">Endpoint</dt>
                      <dd className="font-mono text-surface-200 break-all">{handling.endpoint}</dd>
                    </div>
                    <div>
                      <dt className="text-surface-500">API key env</dt>
                      <dd className="font-mono text-surface-200">{handlingProvider.apiKeyEnv}</dd>
                    </div>
                    <div>
                      <dt className="text-surface-500">Extra headers</dt>
                      <dd className="font-mono text-surface-200 whitespace-pre-wrap">{handlingProvider.headers?.trim() || 'None'}</dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-lg border border-surface-700 bg-surface-900 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-surface-200">Attachment Rules</h4>
                  <ul className="space-y-2 text-xs text-surface-300">
                    {handling.attachmentRules.map(rule => <li key={rule}>- {rule}</li>)}
                  </ul>
                </section>

                <section className="rounded-lg border border-surface-700 bg-surface-900 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-surface-200">Payload Shape</h4>
                  <ul className="space-y-2 text-xs text-surface-300">
                    {handling.requestShape.map(rule => <li key={rule}>- {rule}</li>)}
                  </ul>
                  <div className="mt-3 rounded-md bg-surface-950 p-3 text-[11px] text-surface-400">
                    All run requests use normalized browser input first: <span className="font-mono text-surface-200">systemPrompt</span>, <span className="font-mono text-surface-200">userMessage</span>, and <span className="font-mono text-surface-200">attachments[]</span>. The server adapter converts that into this provider's wire format.
                  </div>
                </section>

                <section className="rounded-lg border border-surface-700 bg-surface-900 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-surface-200">Model-Specific Rules</h4>
                  <div className="space-y-3 text-xs text-surface-300">
                    <div>
                      <div className="text-surface-500">Models in scope</div>
                      <div className="mt-1 font-mono text-surface-200">
                        {handling.selected.length === 0 ? 'None selected' : `${handling.selected.slice(0, 8).join(', ')}${handling.selected.length > 8 ? ', ...' : ''}`}
                      </div>
                    </div>
                    <div>
                      <div className="text-surface-500">max_completion_tokens models</div>
                      <div className="mt-1 font-mono text-surface-200">
                        {handling.completionTokenModels.length === 0 ? 'None detected' : `${handling.completionTokenModels.slice(0, 8).join(', ')}${handling.completionTokenModels.length > 8 ? ', ...' : ''}`}
                      </div>
                    </div>
                    <div>
                      <div className="text-surface-500">Skip behavior</div>
                      <div className="mt-1 text-surface-300">
                        Unsupported files are marked skipped before inference. If a provider rejects an attachment payload, the run is marked skipped and is not retried with a placeholder.
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
