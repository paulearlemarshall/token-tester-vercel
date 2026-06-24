import { encode } from 'gpt-tokenizer'
import type { ChatParams, ModelFetchParams } from './provider-api'

async function sendJson<T>(url: string, payload: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  return res.json()
}

export const webApi = {
  fetchModels(params: ModelFetchParams) {
    return sendJson<any>('/api/models', params)
  },

  chatCompletion(params: ChatParams) {
    return sendJson<any>('/api/chat', params)
  },

  async getPricing() {
    const res = await fetch('/api/pricing')
    if (!res.ok) return {}
    return res.json()
  },

  async getPricingRecords() {
    const res = await fetch('/api/pricing/records')
    if (!res.ok) return { records: [] }
    return res.json()
  },

  async getArchivedResults(limit = 1000) {
    const res = await fetch(`/api/results?limit=${encodeURIComponent(limit)}`)
    if (!res.ok) return { records: [] }
    return res.json()
  },

  saveArchivedResult(params: unknown) {
    return sendJson<any>('/api/results', params)
  },

  updateArchivedResultsSuppressed(ids: number[], suppressed: boolean) {
    return sendJson<any>('/api/results', { ids, suppressed }, 'PATCH')
  },

  deleteArchivedResults(ids: number[]) {
    return sendJson<any>('/api/results', { ids }, 'DELETE')
  },

  async savePricing(params: {
    serviceProvider: string
    modelId: string
    input: number
    output: number
    upstreamProvider?: string | null
    displayName?: string | null
    source?: string
    sourcePriority?: number
    sourceUrl?: string | null
    sourceUpdatedAt?: string | null
    rawSourcePayload?: unknown
    rawProviderPayload?: unknown
    matchStatus?: string
    matchConfidence?: number | null
    matchMethod?: string | null
    matchEvidence?: unknown
  }) {
    return sendJson<any>('/api/pricing', {
      ...params,
      source: params.source ?? 'manual',
    }, 'PUT')
  },

  deletePricing(params: {
    id?: number
    serviceProvider?: string
    modelId?: string
    source?: string
  }) {
    return sendJson<{ deleted: number; keys: string[] }>('/api/pricing', params, 'DELETE')
  },

  async countTokens(text: string) {
    try {
      return encode(text).length
    } catch {
      return text.length
    }
  },
}
