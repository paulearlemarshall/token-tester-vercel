import type { AppConfig, ProviderConfig } from '../types'
import { PROVIDER_PRESETS } from '../utils/constants'
import { saveJSON, loadMigratedConfig } from './helpers'

export interface ConfigSlice {
  config: AppConfig
  initFromPreset: (presetName: string) => void
  addProvider: (p: ProviderConfig) => void
  updateProvider: (id: string, u: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void
}

type Get = () => { config: AppConfig }

export const createConfigSlice = (set: any, get: Get): ConfigSlice => ({
  config: loadMigratedConfig(),

  initFromPreset: (presetName) => {
    const preset = PROVIDER_PRESETS.find((p: any) => p.name === presetName)
    if (!preset) return
    const { providers } = get().config
    if (providers.some((p: ProviderConfig) => p.name === preset.name)) return
    const newProv: ProviderConfig = {
      id: crypto.randomUUID(),
      name: preset.name,
      type: preset.type,
      adapterId: preset.adapterId,
      baseUrl: preset.baseUrl,
      apiKeyEnv: preset.apiKeyEnv,
      models: [...preset.models],
      enabled: true,
    }
    const updated = { providers: [...providers, newProv] }
    set({ config: updated })
    saveJSON('token-tester-config', updated)
  },

  addProvider: (p) => {
    const updated = { providers: [...get().config.providers, p] }
    set({ config: updated })
    saveJSON('token-tester-config', updated)
  },

  updateProvider: (id, u) => {
    const providers = get().config.providers.map((p: ProviderConfig) => p.id === id ? { ...p, ...u } : p)
    const updated = { providers }
    set({ config: updated })
    saveJSON('token-tester-config', updated)
  },

  removeProvider: (id) => {
    const providers = get().config.providers.filter((p: ProviderConfig) => p.id !== id)
    const updated = { providers }
    set({ config: updated })
    saveJSON('token-tester-config', updated)
  },
})
