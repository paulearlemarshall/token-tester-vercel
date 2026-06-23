import type { ProviderType } from '../types'

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
  baseUrl: string
  apiKeyEnv: string
  headers?: string
}

export interface ChatParams {
  provider: {
    type: ProviderType
    baseUrl: string
    apiKeyEnv: string
    headers?: string
  }
  model: string
  messages: unknown[]
  maxTokens?: number
  requestBody?: unknown
}

function centsPer100mToUsdPer1m(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value / 10_000
}

function isXaiBaseUrl(baseUrl: string) {
  return baseUrl.trim().toLowerCase().includes('api.x.ai')
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
}

export async function chatCompletion(params: ChatParams) {
  const { provider, model, messages, maxTokens = 4096 } = params
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

    switch (provider.type) {
      case 'openai-compat':
        if (isXaiBaseUrl(provider.baseUrl)) {
          result = await chatXaiResponses(provider.baseUrl, apiKey, model, messages, maxTokens, provider.headers)
        } else {
          result = await chatOpenAICompat(provider.baseUrl, apiKey, model, messages, maxTokens, provider.headers, params.requestBody)
        }
        break
      case 'anthropic':
        result = await chatAnthropic(apiKey, model, messages, maxTokens)
        break
      case 'gemini':
        result = await chatGemini(apiKey, model, messages, maxTokens)
        break
      default:
        throw new Error(`Unknown provider type: ${provider.type}`)
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
  messages: unknown[],
  baseUrl: string,
  apiKey: string,
  extraHeaders?: string
): Promise<any[]> {
  const fileIdCache = new Map<string, Promise<string>>()
  const input: any[] = []

  for (const message of messages as any[]) {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'system' ? 'system' : 'user'
    const content = message?.content
    if (typeof content === 'string') {
      input.push({ role, content })
      continue
    }

    if (!Array.isArray(content)) {
      input.push({ role, content: String(content ?? '') })
      continue
    }

    const parts: any[] = []
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        parts.push({ type: 'input_text', text: part.text })
        continue
      }

      if (part?.type === 'file' && typeof part.file?.file_data === 'string') {
        const match = part.file.file_data.match(/^data:(.+?);base64,(.+)$/)
        if (!match) throw new Error('xAI file attachments must be base64 data URLs')
        const mimeType = match[1]
        const base64Data = match[2]
        const filename = part.file.filename || 'attachment'
        const cacheKey = `${filename}:${mimeType}:${base64Data.length}:${base64Data.slice(0, 32)}`
        let uploadPromise = fileIdCache.get(cacheKey)
        if (!uploadPromise) {
          uploadPromise = uploadXaiFile(baseUrl, apiKey, filename, mimeType, base64Data, extraHeaders)
          fileIdCache.set(cacheKey, uploadPromise)
        }
        const fileId = await uploadPromise
        parts.push({ type: 'input_file', file_id: fileId })
        continue
      }

      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        parts.push({ type: 'input_image', image_url: part.image_url.url })
        continue
      }

      if (part?.text) {
        parts.push({ type: 'input_text', text: String(part.text) })
      }
    }

    input.push(parts.length > 0 ? { role, content: parts } : { role, content: '' })
  }

  return input
}

async function chatXaiResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  maxTokens: number,
  extraHeaders?: string
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/responses`
  const input = await buildXaiResponsesInput(messages, baseUrl, apiKey, extraHeaders)
  const extra = parseHeaders(extraHeaders)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
    body: JSON.stringify({ model, input, max_output_tokens: maxTokens }),
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
  }
}

async function chatOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  maxTokens: number,
  extraHeaders?: string,
  requestBody?: unknown
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const extra = parseHeaders(extraHeaders)
  const body = requestBody ?? { model, messages, max_tokens: maxTokens }

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
  }
}

async function chatAnthropic(apiKey: string, model: string, messages: any[], maxTokens: number): Promise<ApiResult> {
  const systemMsg = messages.find((m: any) => m.role === 'system')
  const otherMsgs = messages.filter((m: any) => m.role !== 'system')

  const body: any = {
    model,
    messages: otherMsgs.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: buildAnthropicContent(m.content),
    })),
    max_tokens: maxTokens,
  }
  if (systemMsg) body.system = buildAnthropicContent(systemMsg.content)

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
  }
}

function buildAnthropicContent(content: any): any {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (part.type === 'image_url') {
        const match = part.image_url.url.match(/^data:(.+?);base64,(.+)$/)
        if (match) {
          const isDoc = match[1].startsWith('application/')
          return { type: isDoc ? 'document' : 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        }
      }
      return { type: 'text', text: part.text ?? '' }
    })
  }
  return String(content)
}

async function chatGemini(apiKey: string, model: string, messages: any[], maxTokens: number): Promise<ApiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const contents: any[] = []
  for (const msg of messages) {
    if (msg.role === 'system') continue
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildGeminiParts(msg.content),
    })
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
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
  }
}

function buildGeminiParts(content: any): any[] {
  if (typeof content === 'string') return [{ text: content }]
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (part.type === 'image_url') {
        const match = part.image_url.url.match(/^data:(.+?);base64,(.+)$/)
        if (match) return { inlineData: { mimeType: match[1], data: match[2] } }
      }
      return { text: part.text ?? '' }
    })
  }
  return [{ text: String(content) }]
}
