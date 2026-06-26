import type { ProviderConfig } from '../types'
import { loadMigratedPricing, saveJSON } from './helpers'

export interface PricingSlice {
  modelScope: Record<string, Record<string, boolean>>
  setModelScope: (providerId: string, modelId: string, inScope: boolean) => void
  setModelScopes: (scope: Record<string, Record<string, boolean>>) => void
  toggleAllModels: (providerId: string, inScope: boolean) => void
  modelPricing: Record<string, { input: number; output: number }>
  setModelPricing: (key: string, input: number, output: number) => void
  removeModelPricing: (keys: string[]) => void
  builtinPricing: Record<string, { input: number; output: number; per: string }>
  loadBuiltinPricing: (data: Record<string, { input: number; output: number; per: string }>) => void
}

interface PricingCrossSlice {
  config: { providers: ProviderConfig[] }
  modelScope: Record<string, Record<string, boolean>>
  modelPricing: Record<string, { input: number; output: number }>
  builtinPricing: Record<string, { input: number; output: number; per: string }>
}

type Get = () => PricingCrossSlice

export const createPricingSlice = (set: any, get: Get): PricingSlice => ({
  modelScope: {},
  setModelScope: (providerId, modelId, inScope) => set((s: any) => {
    const current = s.modelScope[providerId] ?? {}
    return { modelScope: { ...s.modelScope, [providerId]: { ...current, [modelId]: inScope } } }
  }),
  setModelScopes: (scope) => set({ modelScope: scope }),
  toggleAllModels: (providerId, inScope) => set((s: any) => {
    const prov = s.config.providers.find((p: ProviderConfig) => p.id === providerId)
    if (!prov) return s
    const all: Record<string, boolean> = {}
    prov.models.forEach((m: string) => { all[m] = inScope })
    if (!inScope) {
      for (const model of Object.keys(s.modelScope[providerId] ?? {})) all[model] = false
    }
    return { modelScope: { ...s.modelScope, [providerId]: all } }
  }),

  modelPricing: loadMigratedPricing(),
  setModelPricing: (key, input, output) => set((s: any) => {
    const next = { ...s.modelPricing, [key]: { input, output } }
    saveJSON('token-tester-model-pricing', next)
    return { modelPricing: next, builtinPricing: { ...s.builtinPricing, [key]: { input, output, per: '1M' } } }
  }),
  removeModelPricing: (keys) => set((s: any) => {
    const modelPricing = { ...s.modelPricing }
    const builtinPricing = { ...s.builtinPricing }
    for (const key of keys) {
      delete modelPricing[key]
      delete builtinPricing[key]
    }
    saveJSON('token-tester-model-pricing', modelPricing)
    return { modelPricing, builtinPricing }
  }),

  builtinPricing: {},
  loadBuiltinPricing: (data) => set({ builtinPricing: data }),
})
