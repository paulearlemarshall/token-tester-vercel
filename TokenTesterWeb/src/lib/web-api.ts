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

  async savePricing(params: {
    serviceProvider: string
    modelId: string
    input: number
    output: number
    upstreamProvider?: string | null
    displayName?: string | null
  }) {
    return sendJson<any>('/api/pricing', {
      ...params,
      source: 'manual',
    }, 'PUT')
  },

  async countTokens(text: string) {
    try {
      return encode(text).length
    } catch {
      return text.length
    }
  },
}
