import { encode } from 'gpt-tokenizer'
import type { ChatParams, ModelFetchParams } from './provider-api'

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
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
    return postJson<any>('/api/models', params)
  },

  chatCompletion(params: ChatParams) {
    return postJson<any>('/api/chat', params)
  },

  async getPricing() {
    const res = await fetch('/api/pricing')
    if (!res.ok) return {}
    return res.json()
  },

  async countTokens(text: string) {
    try {
      return encode(text).length
    } catch {
      return text.length
    }
  },
}
