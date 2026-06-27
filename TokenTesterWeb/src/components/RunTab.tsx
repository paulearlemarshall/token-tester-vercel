import { useState } from 'react'
import { Play, Square, Loader2, CheckCircle, XCircle, Clock, Trash2, ChevronRight, ChevronDown, ChevronLeft, Copy, Check, List, FileText, RotateCcw, X, ToggleLeft, ToggleRight } from 'lucide-react'
import { useStore } from '../store'
import type { AttachedFile, DebugEntry, FileItem, RunPreviewInfo, TestRun } from '../types'
import { estimateCost, formatDuration, truncate } from '../utils/formatters'
import { webApi } from '../lib/web-api'
import { canonicalProviderKey, effectivePricing as resolveEffectivePricing, pricingLookupKeys, type ProviderKeyInput } from '../lib/provider-key'
import { buildRunInput, filesForRun, unsupportedAttachmentReason } from '../lib/run-input'
import { getProviderAdapter } from '../lib/provider-registry'
import { ResponseRenderer, responseDisplayValue } from './ResponseRenderer'

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

function createRunTimestamp() {
  return Date.now()
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

type AudioRoute = 'transcription' | 'chat-compat' | 'responses' | 'none'

function audioRoutingForModel(model: string, metas: any[], files: AttachedFile[]): AudioRoute {
  const hasAudio = files.some(f => f.type === 'audio' || (f.mimeType || '').startsWith('audio/'))
  if (!hasAudio) return 'none'
  const hasNonAudioBinary = files.some(f => f.type !== 'audio' && f.type !== 'text' && !(f.mimeType || '').startsWith('audio/'))
  if (hasNonAudioBinary) return 'none'
  const meta = metas?.find(item => item.id === model)
  const outMods = (meta?.outputModalities ?? []).map((m: string) => m.toLowerCase())
  const isTranscription = outMods.includes('transcription') || /(?:^|\/)(whisper|gpt-4o-transcribe|gpt-4o-mini-transcribe)/i.test(model)
  return isTranscription ? 'transcription' : 'chat-compat'
}

function formatSize(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function payloadPreviewFiles(files: AttachedFile[]): string[] {
  const previews: string[] = []
  for (const f of files) {
    const ext = (f.ext || '').toLowerCase()
    const mime = (f.mimeType || '').toLowerCase()
    let label = 'FILE'
    if (f.type === 'image' || mime.startsWith('image/')) label = 'IMAGE'
    else if (f.type === 'audio' || mime.startsWith('audio/')) label = 'AUDIO'
    else if (f.type === 'video' || mime.startsWith('video/')) label = 'VIDEO'
    else if (ext === '.pdf' || mime === 'application/pdf') label = 'PDF'
    const sizeLabel = formatSize(f.size)
    previews.push(f.base64 ? `[BASE64_${label}: ${sizeLabel}]` : `[EMBEDDED_FILE: ${f.name}]`)
  }
  return previews
}

function computeRunPreview(provider: any, model: string, files: AttachedFile[], systemPrompt: string, userMessage: string): RunPreviewInfo {
  const adapter = getProviderAdapter(provider)
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '')
  const metas = provider.modelMetas || []
  const audioRoute = audioRoutingForModel(model, metas, files)
  const filePreviews = payloadPreviewFiles(files)
  const hasAudio = files.some(f => f.type === 'audio' || (f.mimeType || '').startsWith('audio/'))
  const hasImage = files.some(f => f.type === 'image' || (f.mimeType || '').startsWith('image/'))
  const hasDoc = files.some(f => f.type === 'document' || (f.ext || '').toLowerCase() === '.pdf')
  const effectiveUserMsg = userMessage || defaultUserMessage(model, files, hasAudio)

  let endpoint: string
  let payloadPreview: string
  const handlingNotes: string[] = []

  switch (adapter.id) {
    case 'openai': {
      if (audioRoute === 'transcription') {
        endpoint = `${baseUrl}/v1/audio/transcriptions`
        const parts = [`model: "${model}"`, `file: ${filePreviews[0] || '[BASE64_AUDIO]'}`]
        payloadPreview = `multipart/form-data { ${parts.join(', ')} }`
        handlingNotes.push(`Audio-only with transcription-capable model → /v1/audio/transcriptions`)
        handlingNotes.push(`Each audio file transcribed separately, results concatenated as text`)
      } else if (audioRoute === 'chat-compat') {
        endpoint = `${baseUrl}/v1/chat/completions`
        const contentParts: string[] = [`{ type: "text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
        for (const fp of filePreviews) {
          contentParts.push(`{ type: "input_audio", input_audio: { data: ${fp}, format: "..." } }`)
        }
        const messages: string[] = []
        if (systemPrompt) messages.push(`{ role: "system", content: ${JSON.stringify(truncate(systemPrompt, 60))} }`)
        messages.push(`{ role: "user", content: [ ${contentParts.join(', ')} ] }`)
        payloadPreview = `{ model: "${model}", messages: [ ${messages.join(', ')} ], max_tokens: 4096 }`
        handlingNotes.push(`Audio on chat model (gpt-audio) → /v1/chat/completions with input_audio`)
        handlingNotes.push(`System prompt goes into messages[0] (responses-style instructions not used here)`)
      } else {
        endpoint = `${baseUrl}/v1/responses`
        const inputParts: string[] = [`{ type: "input_text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
        for (const fp of filePreviews) {
          const partType = hasImage ? 'input_image' : hasDoc ? 'input_file' : 'input_text'
          inputParts.push(`{ type: "${partType}", data: ${fp}, ... }`)
        }
        payloadPreview = `{ model: "${model}", input: [{ role: "user", content: [ ${inputParts.join(', ')} ] }]`
        if (systemPrompt) payloadPreview += `, instructions: ${JSON.stringify(truncate(systemPrompt, 60))}`
        payloadPreview += ` }`
        handlingNotes.push(`Text/image/doc → /v1/responses (OpenAI Responses API)`)
        handlingNotes.push(`System prompt sent as top-level "instructions"`)
      }
      break
    }
    case 'xai': {
      if (audioRoute === 'transcription') {
        endpoint = `${baseUrl}/v1/audio/transcriptions`
        payloadPreview = `multipart/form-data { model: "${model}", file: ${filePreviews[0] || '[BASE64_AUDIO]'} }`
        handlingNotes.push(`Audio-only with transcription model → /v1/audio/transcriptions`)
      } else if (hasAudio) {
        endpoint = `${baseUrl}/v1/stt`
        payloadPreview = `[Audio transcribed first via /v1/stt, then transcript text sent]`
        handlingNotes.push(`Audio attachments are first transcribed through /v1/stt, then sent as transcript text to the model`)
        handlingNotes.push(`Final request uses /v1/responses with the transcript text`)
      } else {
        endpoint = `${baseUrl}/v1/responses`
        const inputParts: string[] = [`{ type: "input_text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
        payloadPreview = `{ model: "${model}", input: [{ role: "user", content: [ ${inputParts.join(', ')} ] }]`
        if (systemPrompt) payloadPreview += `, instructions: ${JSON.stringify(truncate(systemPrompt, 60))}`
        payloadPreview += ` }`
        handlingNotes.push(`Text/image → /v1/responses (xAI Responses API)`)
      }
      break
    }
    case 'anthropic': {
      endpoint = `${baseUrl}/v1/messages`
      const contentParts: string[] = [`{ type: "text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
      for (const fp of filePreviews) {
        contentParts.push(`{ type: "image", source: { type: "base64", media_type: "...", data: ${fp} } }`)
      }
      payloadPreview = `{ model: "${model}", max_tokens: 4096, messages: [{ role: "user", content: [ ${contentParts.join(', ')} ] }]`
      if (systemPrompt) payloadPreview += `, system: ${JSON.stringify(truncate(systemPrompt, 60))}`
      payloadPreview += ` }`
      handlingNotes.push(`Anthropic Messages API — /v1/messages`)
      handlingNotes.push(`System prompt sent as top-level "system" parameter (not in messages)`)
      if (hasAudio) handlingNotes.push(`Anthropic does not support audio attachments natively`)
      break
    }
    case 'gemini': {
      endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`
      const parts: string[] = [`{ text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
      for (const fp of filePreviews) {
        parts.push(`{ inlineData: { mimeType: "...", data: ${fp} } }`)
      }
      payloadPreview = `{ contents: [{ role: "user", parts: [ ${parts.join(', ')} ] }]`
      if (systemPrompt) payloadPreview += `, systemInstruction: { parts: [{ text: ${JSON.stringify(truncate(systemPrompt, 60))} }] }`
      payloadPreview += ` }`
      handlingNotes.push(`Gemini generateContent API — /v1beta/models/{model}:generateContent`)
      handlingNotes.push(`Audio/video/image/document files sent as inlineData`)
      break
    }
    case 'openrouter': {
      if (audioRoute === 'transcription') {
        endpoint = `${baseUrl}/v1/audio/transcriptions`
        payloadPreview = `multipart/form-data { model: "${model}", file: ${filePreviews[0] || '[BASE64_AUDIO]'} }`
        handlingNotes.push(`Audio-only with transcription-output model → /v1/audio/transcriptions via OpenRouter`)
      } else {
        endpoint = `${baseUrl}/v1/chat/completions`
        const contentParts: string[] = [`{ type: "text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
        for (const fp of filePreviews) {
          if (hasAudio) contentParts.push(`{ type: "input_audio", inputAudio: { data: ${fp}, format: "..." } }`)
          else if (hasImage) contentParts.push(`{ type: "image_url", image_url: { url: "data:...;base64,${fp}" } }`)
        }
        const messages: string[] = []
        if (systemPrompt) messages.push(`{ role: "system", content: ${JSON.stringify(truncate(systemPrompt, 60))} }`)
        messages.push(`{ role: "user", content: [ ${contentParts.join(', ')} ] }`)
        payloadPreview = `{ model: "${model}", messages: [ ${messages.join(', ')} ] }`
        handlingNotes.push(`OpenRouter /v1/chat/completions`)
        if (hasAudio) handlingNotes.push(`OpenRouter uses inputAudio content part for audio`)
      }
      break
    }
    default: {
      endpoint = `${baseUrl}/v1/chat/completions`
      const contentParts: string[] = [`{ type: "text", text: ${JSON.stringify(truncate(effectiveUserMsg, 80))} }`]
      for (const fp of filePreviews) {
        contentParts.push(`{ type: "image_url", image_url: { url: "data:...;base64,${fp}" } }`)
      }
      const messages: string[] = []
      if (systemPrompt) messages.push(`{ role: "system", content: ${JSON.stringify(truncate(systemPrompt, 60))} }`)
      messages.push(`{ role: "user", content: [ ${contentParts.join(', ')} ] }`)
      payloadPreview = `{ model: "${model}", messages: [ ${messages.join(', ')} ] }`
      handlingNotes.push(`OpenAI-compatible /v1/chat/completions`)
      handlingNotes.push(`Attachment support depends on the provider's capabilities`)
      break
    }
  }

  if (!userMessage && files.length > 0) {
    handlingNotes.push(`No user prompt provided; using default: ${JSON.stringify(effectiveUserMsg)}`)
  }

  return { endpoint, payloadPreview, handlingNotes }
}

function defaultUserMessage(model: string, files: AttachedFile[], hasAudio: boolean) {
  if (files.length === 0) return 'Hello'
  if (hasAudio && files.every(f => f.type === 'audio')) return 'Perform speech to text on this file'
  if (files.length === 1) return `Analyze this file: ${files[0].name}`
  return `Analyze the following ${files.length} files:`
}

export function RunTab() {
  const {
    config, systemPrompt, customPrompts, fileItems,
    queue, setQueue, updateRun, clearQueue,
    isRunning, setIsRunning, setActiveTab,
    modelScope,
    modelPricing, builtinPricing,
    debugEntries, pushDebugEntry, removeDebugEntry, clearDebugEntries,
  } = useStore()
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [subTab, setSubTab] = useState<'queue' | 'output'>('queue')
  const [outputIndex, setOutputIndex] = useState(0)
  const [filterModel, setFilterModel] = useState<string | null>(null)
  const [filterFile, setFilterFile] = useState<string | null>(null)
  const [hideFailedOutput, setHideFailedOutput] = useState(false)
  const [requestCollapsed, setRequestCollapsed] = useState(true)
  const [expandedQueueRun, setExpandedQueueRun] = useState<Set<string>>(new Set())
  const parallelEnabled = useStore(s => s.parallelEnabled)
  const setParallelEnabled = useStore(s => s.setParallelEnabled)
  const parallelJobs = useStore(s => s.parallelJobs)
  const setParallelJobs = useStore(s => s.setParallelJobs)
  const [runName, setRunName] = useState('')

  const enabledProviders = config.providers.filter((p: any) => p.enabled)

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
      const category = await webApi.classifyDocumentCategory({
        fileName: run.file?.name ?? (run.batchFiles ? `batch (${run.batchFiles.length})` : null),
        filePath: run.file?.path ?? null,
        sourceLabel: run.sourceLabel,
        userMessage: run.userMessage,
        responseText: result.responseText,
        metadata: run.file?.metadata ?? null,
        fileContent: files.map(file => file.content || '').filter(Boolean).join('\n\n').slice(0, 6000),
      }).catch(() => null)

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
        documentCategory: category?.category ?? null,
        documentCategoryConfidence: category?.confidence ?? null,
        documentCategorySource: category?.source ?? null,
        requestPayload: result.requestPayload,
        responsePayload: result,
        runStartedAt: run.timestamp,
        runName: run.runName ?? null,
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
          const files = tc.batchFiles ?? (tc.file ? [tc.file] : [])
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
            timestamp: createRunTimestamp(),
            priceOverride: pricingLookupKeys(prov, model)
              .map(key => modelPricing[key])
              .find(price => price && (price.input > 0 || price.output > 0)),
            preview: computeRunPreview(prov, model, files, systemPrompt, tc.userMessage),
            runName: runName || undefined,
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
        provider: { type: prov.type, adapterId: prov.adapterId, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers, modelMetas: prov.modelMetas },
        model: run.model,
        input,
        maxTokens: 4096,
      })

      if (result.error && /max_tokens.*max_completion_tokens/i.test(result.error)) {
        result = await webApi.chatCompletion({
          provider: { type: prov.type, adapterId: prov.adapterId, baseUrl: prov.baseUrl, apiKeyEnv: prov.apiKeyEnv, headers: prov.headers, modelMetas: prov.modelMetas },
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

    if (!parallelEnabled) {
      for (let i = 0; i < pendingRuns.length; i++) {
        const run = pendingRuns[i]
        if (!useStore.getState().isRunning) break
        await executeRun(run)
      }
    } else {
      const byProvider = new Map<string, TestRun[]>()
      for (const run of pendingRuns) {
        const list = byProvider.get(run.providerName) ?? []
        list.push(run)
        byProvider.set(run.providerName, list)
      }

      const waitForSlot = (() => {
        const active = new Map<string, number>()
        const pending: (() => void)[] = []
        return {
          acquire: async (provider: string) => {
            const count = active.get(provider) ?? 0
            if (count < parallelJobs) {
              active.set(provider, count + 1)
              return
            }
            await new Promise<void>(resolve => { pending.push(resolve) })
            active.set(provider, (active.get(provider) ?? 0) + 1)
          },
          release: (provider: string) => {
            active.set(provider, (active.get(provider) ?? 0) - 1)
            const next = pending.shift()
            if (next) next()
          },
        }
      })()

      const tasks = Array.from(byProvider.entries()).flatMap(([provider, runs]) =>
        runs.map(async run => {
          if (!useStore.getState().isRunning) return
          await waitForSlot.acquire(provider)
          if (!useStore.getState().isRunning) { waitForSlot.release(provider); return }
          try {
            await executeRun(run)
          } finally {
            waitForSlot.release(provider)
          }
        })
      )

      await Promise.all(tasks)
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
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0 pr-1">
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

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-surface-400">Run Name:</span>
              <input
                type="text"
                value={runName}
                onChange={e => setRunName(e.target.value)}
                placeholder="(optional)"
                className="input w-56 text-sm"
              />
            </div>
            <div className="flex items-center gap-4 ml-auto">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={parallelEnabled}
                  onChange={e => setParallelEnabled(e.target.checked)}
                  className="rounded border-surface-600 bg-surface-800 text-brand-gold focus:ring-brand-gold/30"
                />
                <span className="text-surface-300">Run parallel across providers</span>
              </label>
              {parallelEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-surface-400">Jobs per provider:</span>
                  <select
                    value={parallelJobs}
                    onChange={e => setParallelJobs(Number(e.target.value))}
                    className="input w-20 text-sm"
                  >
                    {[1, 2, 3, 4, 5].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}
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

          {queue.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-surface-300 mb-2">Queue ({queue.length})</h3>
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {queue.map((run: TestRun) => {
                  const expanded = expandedQueueRun.has(run.id)
                  return (
                    <div key={run.id}>
                      <div className="card flex items-center gap-3 py-1.5 px-3">
                        <button
                          onClick={() => setExpandedQueueRun(prev => {
                            const next = new Set(prev)
                            if (next.has(run.id)) next.delete(run.id); else next.add(run.id)
                            return next
                          })}
                          className="text-surface-500 hover:text-surface-300 shrink-0"
                          title={expanded ? 'Collapse details' : 'Expand details'}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
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
                      {expanded && run.preview && (
                        <div className="card border-t-0 rounded-t-none px-3 py-2 text-[11px] space-y-1.5">
                          <div>
                            <span className="text-surface-500 font-medium">Endpoint: </span>
                            <span className="font-mono text-surface-300 break-all">{run.preview.endpoint}</span>
                          </div>
                          <div>
                            <span className="text-surface-500 font-medium">Payload: </span>
                            <span className="font-mono text-surface-400 break-all text-[10px]">{run.preview.payloadPreview}</span>
                          </div>
                          {run.preview.handlingNotes.length > 0 && (
                            <div>
                              <span className="text-surface-500 font-medium">Handling: </span>
                              <ul className="list-disc list-inside text-surface-400 space-y-0.5 mt-0.5">
                                {run.preview.handlingNotes.map((note, i) => (
                                  <li key={i}>{note}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
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
    </div>
  )
}
