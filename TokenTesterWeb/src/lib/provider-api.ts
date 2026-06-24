import type { ProviderAdapterId, ProviderType } from '../types'
import type { NormalizedAttachment, NormalizedRunInput } from './run-input'
import { getProviderAdapter } from './provider-registry'

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  const headers: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (k && v) headers[k] = v
  }
  return headers
}

export interface ModelFetchParams {
  type: ProviderType
  adapterId?: ProviderAdapterId
  baseUrl: string
  apiKeyEnv: string
  headers?: string
}

export interface ChatParams {
  provider: {
    type: ProviderType
    adapterId?: ProviderAdapterId
    baseUrl: string
    apiKeyEnv: string
    headers?: string
  }
  model: string
  input?: NormalizedRunInput
  messages?: unknown[]
  maxTokens?: number
}

function centsPer100mToUsdPer1m(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value / 10_000
}

export async function fetchProviderModels(params: ModelFetchParams) {
  const apiKey = process.env[params.apiKeyEnv] || ''
  if (!apiKey) return { models: [], error: `API key not found for env var "${params.apiKeyEnv}"` }

  try {
    if (params.type === 'openai-compat') {
      const url = `${params.baseUrl.replace(/\/+$/, '')}/v1/models`
      const extra = parseHeaders(params.headers)
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, ...extra },
      })
      if (!res.ok) return { models: [], error: `${res.status}: ${res.statusText}` }
      const data = await res.json()
      const rawModels = data.data || []
      const models = rawModels
        .map((m: any) => m.id)
        .filter((id: string) => !id.startsWith('ft:'))
        .sort()
      const modelMetas = rawModels.map((m: any) => ({
        id: m.id,
        created: m.created,
        owned_by: m.owned_by,
        context_length: m.context_length,
        modality: m.architecture?.modality,
      }))
      const rawModelsById = Object.fromEntries(rawModels.map((m: any) => [m.id, m]))
      const pricing: Record<string, { input: number; output: number }> = {}
      for (const m of rawModels) {
        if (m.pricing?.prompt != null || m.pricing?.completion != null) {
          pricing[m.id] = {
            input: (m.pricing.prompt ?? 0) * 1_000_000,
            output: (m.pricing.completion ?? 0) * 1_000_000,
          }
          continue
        }

        const xaiInput = centsPer100mToUsdPer1m(m.prompt_text_token_price)
        const xaiOutput = centsPer100mToUsdPer1m(m.completion_text_token_price)
        if (xaiInput != null || xaiOutput != null) {
          pricing[m.id] = {
            input: xaiInput ?? 0,
            output: xaiOutput ?? 0,
          }
        }
      }
      return {
        models,
        modelMetas: modelMetas.length > 0 ? modelMetas : undefined,
        rawModels: rawModelsById,
        pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
        responseText: JSON.stringify(data, null, 2),
      }
    }

    if (params.type === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) return { models: [], error: `${res.status}: ${res.statusText}` }
      const data = await res.json()
      const models = (data.models || [])
        .map((m: any) => m.name.replace('models/', ''))
        .filter((id: string) => id.startsWith('gemini-'))
        .sort()
      return { models, responseText: JSON.stringify(data, null, 2) }
    }

    if (params.type === 'anthropic') {
      const url = `${params.baseUrl.replace(/\/+$/, '')}/v1/models`
      const res = await fetch(url, {
        headers: { 'X-Api-Key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) return { models: [], error: `${res.status}: ${res.statusText}` }
      const data = await res.json()
      const rawModels = data.data || []
      const models = rawModels.map((m: any) => m.id).sort()
      return {
        models,
        modelMetas: rawModels.map((m: any) => ({ id: m.id, created: m.created_at })),
        responseText: JSON.stringify(data, null, 2),
      }
    }

    return { models: [], error: `Unknown provider type: ${params.type}` }
  } catch (err: any) {
    return { models: [], error: err.message ?? String(err) }
  }
}

interface ApiResult {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  responseText: string
  error?: string
  requestPayload?: unknown
  requestUrl?: string
}

export async function chatCompletion(params: ChatParams) {
  const { provider, model, maxTokens = 4096 } = params
  const input = params.input ?? legacyMessagesToRunInput(params.messages ?? [])
  const apiKey = process.env[provider.apiKeyEnv] || ''
  if (!apiKey) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      responseText: '',
      latencyMs: 0,
      error: `API key not found for env var "${provider.apiKeyEnv}". Configure it in Vercel project environment variables.`,
    }
  }

  const start = performance.now()

  try {
    let result: ApiResult
    const adapter = getProviderAdapter(provider)

    switch (adapter.id) {
      case 'xai':
        result = await chatXaiResponses(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers)
        break
      case 'anthropic':
        result = await chatAnthropic(apiKey, model, input, maxTokens)
        break
      case 'gemini':
        result = await chatGemini(apiKey, model, input, maxTokens)
        break
      case 'openai':
      case 'openrouter':
      case 'deepseek':
      case 'mistral':
      case 'ssnc-ai-gateway':
      case 'custom-openai-compatible':
        result = await chatOpenAICompat(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers)
        break
      default:
        throw new Error(`Unknown provider adapter: ${adapter.id}`)
    }

    const latencyMs = Math.round(performance.now() - start)
    return { ...result, latencyMs }
  } catch (err: any) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      responseText: '',
      latencyMs: Math.round(performance.now() - start),
      error: err.message ?? String(err),
    }
  }
}

function legacyMessagesToRunInput(messages: unknown[]): NormalizedRunInput {
  const systemPrompt = (messages as any[]).find((m: any) => m?.role === 'system')?.content ?? ''
  const user = (messages as any[]).find((m: any) => m?.role !== 'system')
  const content = user?.content
  if (typeof content === 'string') {
    return { systemPrompt: String(systemPrompt), userMessage: content, attachments: [] }
  }
  if (!Array.isArray(content)) {
    return { systemPrompt: String(systemPrompt), userMessage: 'Hello', attachments: [] }
  }
  const textParts = content.filter((part: any) => part?.type === 'text').map((part: any) => part.text).filter(Boolean)
  const attachments: NormalizedAttachment[] = content.flatMap((part: any) => {
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      const match = part.image_url.url.match(/^data:(.+?);base64,(.+)$/)
      if (!match) return []
      const mimeType = match[1]
      return [{ kind: mimeType.startsWith('application/') ? 'document' : 'image', filename: 'attachment', mimeType, base64: match[2] }]
    }
    if (part?.type === 'file' && typeof part.file?.file_data === 'string') {
      const match = part.file.file_data.match(/^data:(.+?);base64,(.+)$/)
      if (!match) return []
      return [{ kind: 'document', filename: part.file.filename ?? 'attachment', mimeType: match[1], base64: match[2] }]
    }
    return []
  })
  return { systemPrompt: String(systemPrompt), userMessage: textParts.join('\n') || 'Hello', attachments }
}

function textWithAttachmentLabels(input: NormalizedRunInput) {
  const labels = input.attachments
    .filter(attachment => attachment.kind !== 'text')
    .map(attachment => `\n--- ${attachment.filename} ---`)
    .join('')
  const textAttachments = input.attachments
    .filter(attachment => attachment.kind === 'text' && attachment.text)
    .map(attachment => `\n--- ${attachment.filename} ---\n\`\`\`\n${attachment.text}\n\`\`\``)
    .join('')
  return `${input.userMessage || 'Hello'}${labels}${textAttachments}`
}

function needsCompletionTokens(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model) || model.toLowerCase().includes('reasoning')
}

function buildOpenAICompatMessages(input: NormalizedRunInput) {
  const messages: any[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  const content: any[] = [{ type: 'text', text: textWithAttachmentLabels(input) }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      content.push({ type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` } })
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      content.push({ type: 'file', file: { filename: attachment.filename, file_data: `data:${attachment.mimeType};base64,${attachment.base64}` } })
    }
  }
  messages.push({ role: 'user', content })
  return messages
}

function parseXaiResponseText(data: any): string {
  const lastMessage = Array.isArray(data?.output) ? data.output.at(-1) : null
  const content = Array.isArray(lastMessage?.content) ? lastMessage.content : []
  const textPart = content.find((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
  return textPart?.text ?? ''
}

function parseXaiUsage(data: any) {
  const inputTokens = data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0
  const outputTokens = data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0
  const totalTokens = data?.usage?.total_tokens ?? (inputTokens + outputTokens)
  return { inputTokens, outputTokens, totalTokens }
}

async function uploadXaiFile(
  baseUrl: string,
  apiKey: string,
  filename: string,
  mimeType: string,
  base64Data: string,
  extraHeaders?: string
): Promise<string> {
  const uploadUrl = `${baseUrl.replace(/\/+$/, '')}/v1/files`
  const body = new FormData()
  body.append('file', new Blob([Buffer.from(base64Data, 'base64')], { type: mimeType }), filename)
  const extra = parseHeaders(extraHeaders)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...extra },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  const data = await res.json()
  if (!data?.id) throw new Error('xAI file upload did not return a file id')
  return data.id
}

async function buildXaiResponsesInput(
  inputRun: NormalizedRunInput,
  baseUrl: string,
  apiKey: string,
  extraHeaders?: string
): Promise<any[]> {
  const fileIdCache = new Map<string, Promise<string>>()
  const input: any[] = []
  if (inputRun.systemPrompt) input.push({ role: 'system', content: inputRun.systemPrompt })

  const parts: any[] = [{ type: 'input_text', text: textWithAttachmentLabels(inputRun) }]
  for (const attachment of inputRun.attachments) {
    if (attachment.kind === 'document') {
      if (!attachment.base64 || !attachment.mimeType) throw new Error('xAI document attachments must include base64 data and mime type')
      const cacheKey = `${attachment.filename}:${attachment.mimeType}:${attachment.base64.length}:${attachment.base64.slice(0, 32)}`
      let uploadPromise = fileIdCache.get(cacheKey)
      if (!uploadPromise) {
        uploadPromise = uploadXaiFile(baseUrl, apiKey, attachment.filename, attachment.mimeType, attachment.base64, extraHeaders)
        fileIdCache.set(cacheKey, uploadPromise)
      }
      const fileId = await uploadPromise
      parts.push({ type: 'input_file', file_id: fileId })
    } else if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.base64}` })
    }
  }
  input.push({ role: 'user', content: parts })

  return input
}

async function chatXaiResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputRun: NormalizedRunInput,
  maxTokens: number,
  extraHeaders?: string
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/responses`
  const input = await buildXaiResponsesInput(inputRun, baseUrl, apiKey, extraHeaders)
  const extra = parseHeaders(extraHeaders)
  const body = { model, input, max_output_tokens: maxTokens }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  const { inputTokens, outputTokens, totalTokens } = parseXaiUsage(data)
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    responseText: parseXaiResponseText(data),
    requestPayload: body,
    requestUrl: url,
  }
}

async function chatOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: NormalizedRunInput,
  maxTokens: number,
  extraHeaders?: string
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const extra = parseHeaders(extraHeaders)
  const body: any = { model, messages: buildOpenAICompatMessages(input), max_tokens: maxTokens }
  if (needsCompletionTokens(model)) {
    delete body.max_tokens
    body.max_completion_tokens = maxTokens
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    responseText: data.choices?.[0]?.message?.content ?? '',
    requestPayload: body,
    requestUrl: url,
  }
}

async function chatAnthropic(apiKey: string, model: string, input: NormalizedRunInput, maxTokens: number): Promise<ApiResult> {
  const body: any = {
    model,
    messages: [{ role: 'user', content: buildAnthropicContent(input) }],
    max_tokens: maxTokens,
  }
  if (input.systemPrompt) body.system = input.systemPrompt

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    responseText: data.content?.[0]?.text ?? '',
    requestPayload: body,
    requestUrl: 'https://api.anthropic.com/v1/messages',
  }
}

function buildAnthropicContent(input: NormalizedRunInput): any[] {
  const parts: any[] = [{ type: 'text', text: textWithAttachmentLabels(input) }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 } })
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'document', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 } })
    }
  }
  return parts
}

async function chatGemini(apiKey: string, model: string, input: NormalizedRunInput, maxTokens: number): Promise<ApiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const body = { contents: [{ role: 'user', parts: buildGeminiParts(input) }], generationConfig: { maxOutputTokens: maxTokens } }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    responseText: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    requestPayload: body,
    requestUrl: url,
  }
}

function buildGeminiParts(input: NormalizedRunInput): any[] {
  const parts: any[] = []
  if (input.systemPrompt) parts.push({ text: input.systemPrompt })
  parts.push({ text: textWithAttachmentLabels(input) })
  for (const attachment of input.attachments) {
    if ((attachment.kind === 'image' || attachment.kind === 'document' || attachment.kind === 'audio' || attachment.kind === 'video') && attachment.base64 && attachment.mimeType) {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } })
    }
  }
  return parts
}
