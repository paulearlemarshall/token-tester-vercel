import type { ModelMeta, ProviderType, ProviderAdapterId } from '../types'
import type { NormalizedAttachment, NormalizedRunInput } from './run-input'
import { getProviderAdapter } from './provider-registry'
import type { ApiResult } from './adapters/shared'
import { parseHeaders, shouldUseTranscription } from './adapters/shared'
import * as xai from './adapters/xai'
import * as openai from './adapters/openai'
import * as openrouter from './adapters/openrouter'
import * as anthropicAdapter from './adapters/anthropic'
import * as geminiAdapter from './adapters/gemini'
import { chatOpenAICompat } from './adapters/openai-compat'
import { runWithLogging } from './api-logger'

export { parseHeaders, shouldUseTranscription }

export function shouldUseOpenAITranscription(model: string, input: NormalizedRunInput, modelMetas?: ModelMeta[]) {
  return shouldUseTranscription(model, input, modelMetas as any)
}

export function shouldUseOpenRouterTranscription(model: string, input: NormalizedRunInput, modelMetas?: ModelMeta[]) {
  return shouldUseTranscription(model, input, modelMetas as any)
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
    modelMetas?: ModelMeta[]
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
      const baseModelsUrl = `${params.baseUrl.replace(/\/+$/, '')}/v1/models`
      const extra = parseHeaders(params.headers)
      const adapter = getProviderAdapter(params)
      const data = adapter.id === 'openrouter'
        ? await fetchOpenRouterModelCatalog(baseModelsUrl, apiKey, extra)
        : await fetchJsonWithAuth(baseModelsUrl, apiKey, extra)
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
        inputModalities: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities : undefined,
        outputModalities: Array.isArray(m.architecture?.output_modalities) ? m.architecture.output_modalities : undefined,
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

async function fetchJsonWithAuth(url: string, apiKey: string, extraHeaders: Record<string, string>) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

async function fetchOpenRouterModelCatalog(baseModelsUrl: string, apiKey: string, extraHeaders: Record<string, string>) {
  const urls = [
    `${baseModelsUrl}?output_modalities=all`,
    `${baseModelsUrl}?output_modalities=transcription`,
  ]
  const responses = await Promise.all(urls.map(async url => {
    try {
      return await fetchJsonWithAuth(url, apiKey, extraHeaders)
    } catch {
      return { data: [] }
    }
  }))
  const merged = new Map<string, any>()
  for (const item of responses.flatMap(response => response.data || [])) {
    if (item?.id) merged.set(item.id, item)
  }
  if (merged.size > 0) return { data: Array.from(merged.values()) }
  return fetchJsonWithAuth(baseModelsUrl, apiKey, extraHeaders)
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

  let logs: import('./api-logger').LogEntry[] = []
  try {
    const adapter = getProviderAdapter(provider)
    const caller = `${provider.adapterId ?? provider.type}/${model}`

    const wrapped = await runWithLogging(caller, async () => {
      switch (adapter.id) {
        case 'xai':
          return await xai.adapterDispatch(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers, provider.modelMetas as any)
        case 'anthropic':
          return await anthropicAdapter.adapterDispatch(apiKey, model, input, maxTokens)
        case 'gemini':
          return await geminiAdapter.adapterDispatch(apiKey, model, input, maxTokens)
        case 'deepseek':
        case 'mistral':
        case 'ssnc-ai-gateway':
        case 'custom-openai-compatible':
          return await chatOpenAICompat(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers)
        case 'openai':
          return await openai.adapterDispatch(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers, provider.modelMetas as any)
        case 'openrouter':
          return await openrouter.adapterDispatch(provider.baseUrl, apiKey, model, input, maxTokens, provider.headers, provider.modelMetas as any)
        default:
          throw new Error(`Unknown provider adapter: ${adapter.id}`)
      }
    })

    logs = wrapped.logs
    if (wrapped.error) throw wrapped.error
    const latencyMs = Math.round(performance.now() - start)
    return { ...wrapped.result, logs, latencyMs }
  } catch (err: any) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      responseText: '',
      logs,
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
  const rawAttachments = content.flatMap((part: any) => {
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
  }) as NormalizedAttachment[]
  return { systemPrompt: String(systemPrompt), userMessage: textParts.join('\n') || 'Hello', attachments: rawAttachments }
}
