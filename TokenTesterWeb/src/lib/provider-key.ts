import type { ProviderType } from '../types'

export interface ProviderKeyInput {
  name?: string
  type?: ProviderType | string
  baseUrl?: string
}

export function normalizeProviderKey(providerName: string) {
  return providerName
    .trim()
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function canonicalProviderKey(provider: ProviderKeyInput | string) {
  const input = typeof provider === 'string' ? { name: provider } : provider
  const nameKey = normalizeProviderKey(input.name ?? '')
  const type = (input.type ?? '').toLowerCase()
  const baseUrl = (input.baseUrl ?? '').toLowerCase()

  if (
    type === 'gemini'
    || nameKey === 'google-gemini'
    || nameKey === 'gemini'
    || baseUrl.includes('generativelanguage.googleapis.com')
  ) {
    return 'google'
  }

  return nameKey
}

export function pricingLookupKeys(provider: ProviderKeyInput | string, modelId: string) {
  const input = typeof provider === 'string' ? { name: provider } : provider
  const keys = [`${canonicalProviderKey(input)}/${modelId}`]
  const legacyNameKey = normalizeProviderKey(input.name ?? '')
  const legacyKey = `${legacyNameKey}/${modelId}`
  if (legacyNameKey && !keys.includes(legacyKey)) keys.push(legacyKey)
  return keys
}
