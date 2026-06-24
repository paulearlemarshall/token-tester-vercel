import type { ProviderType } from '../types'
import { getProviderAdapter, type ProviderLike } from './provider-registry'

export interface ProviderKeyInput {
  name?: string
  type?: ProviderType | string
  baseUrl?: string
  adapterId?: ProviderLike['adapterId']
}

export type PriceMap = Record<string, { input: number; output: number; per?: string }>

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
  if (input.name || input.type || input.baseUrl || input.adapterId) {
    const adapter = getProviderAdapter({
      name: input.name ?? '',
      type: input.type ?? 'openai-compat',
      baseUrl: input.baseUrl ?? '',
      adapterId: input.adapterId,
    })
    if (adapter.id !== 'custom-openai-compatible') return adapter.canonicalProviderKey
  }
  return normalizeProviderKey(input.name ?? '')
}

export function pricingLookupKeys(provider: ProviderKeyInput | string, modelId: string) {
  const input = typeof provider === 'string' ? { name: provider } : provider
  const keys = [`${canonicalProviderKey(input)}/${modelId}`]
  const legacyNameKey = normalizeProviderKey(input.name ?? '')
  const legacyKey = `${legacyNameKey}/${modelId}`
  if (legacyNameKey && !keys.includes(legacyKey)) keys.push(legacyKey)
  return keys
}

export function effectivePricing(
  provider: ProviderKeyInput | string,
  modelId: string,
  overrides: PriceMap,
  builtinPricing: PriceMap
): { input: number; output: number } {
  const providerModelKeys = pricingLookupKeys(provider, modelId)
  for (const key of providerModelKeys) {
    const override = overrides[key]
    if (override && (override.input > 0 || override.output > 0)) return override
  }
  for (const key of providerModelKeys) {
    if (builtinPricing[key]) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
  }
  if (builtinPricing[modelId]) return { input: builtinPricing[modelId].input, output: builtinPricing[modelId].output }
  const short = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  if (short !== modelId && builtinPricing[short]) return { input: builtinPricing[short].input, output: builtinPricing[short].output }
  const keys = Object.keys(builtinPricing).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (providerModelKeys.some(providerModelKey => providerModelKey.startsWith(key))) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
    if (modelId.startsWith(key)) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
    if (modelId.endsWith(`/${key}`)) return { input: builtinPricing[key].input, output: builtinPricing[key].output }
  }
  return { input: 0, output: 0 }
}

