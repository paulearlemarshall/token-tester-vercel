import models from '../data/models.json'

type NestedPricing = Record<string, Record<string, { input: number; output: number; per?: string }>>

export function flattenPricing(nested: NestedPricing = models as NestedPricing) {
  const flat: Record<string, { input: number; output: number; per: string }> = {}
  for (const [provider, providerModels] of Object.entries(nested)) {
    for (const [model, pricing] of Object.entries(providerModels)) {
      flat[`${provider}/${model}`] = { ...pricing, per: pricing.per ?? '1M' }
    }
  }
  return flat
}
