import type { AppConfig, ThemeMode } from '../types'

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
export function saveJSON(key: string, val: any) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}

export function loadThemeMode(): ThemeMode {
  const mode = loadJSON<ThemeMode | null>('token-tester-theme-mode', null)
  if (mode === 'system' || mode === 'light' || mode === 'dark') return mode
  const legacy = loadJSON<boolean | null>('token-tester-dark-mode', null)
  if (legacy === true) {
    saveJSON('token-tester-theme-mode', 'dark')
    return 'dark'
  }
  if (legacy === false) {
    saveJSON('token-tester-theme-mode', 'light')
    return 'light'
  }
  saveJSON('token-tester-theme-mode', 'system')
  return 'system'
}

function migratePricingKeys(data: Record<string, any>): Record<string, any> {
  const migrated: Record<string, any> = {}
  for (const [key, val] of Object.entries(data)) {
    if (key.includes(' / ')) {
      const [provider, ...rest] = key.split(' / ')
      migrated[`${provider.toLowerCase()}/${rest.join('/')}`] = val
    } else {
      migrated[key] = val
    }
  }
  return migrated
}

function migrateConfig(data: AppConfig): AppConfig {
  const providers = data.providers.map((provider) => {
    if (provider.name !== 'Groq' && provider.apiKeyEnv !== 'GROQ_API_KEY') {
      return { ...provider, adapterId: provider.adapterId ?? inferProviderAdapterId(provider) }
    }
    return {
      ...provider,
      name: 'xAI',
      type: 'openai-compat' as const,
      adapterId: 'xai' as const,
      baseUrl: 'https://api.x.ai',
      apiKeyEnv: 'XAI_API_KEY',
      models: provider.models.length > 0 && provider.name !== 'Groq'
        ? provider.models
        : ['grok-4.3', 'grok-build-0.1'],
      headers: undefined,
    }
  })
  const migrated = { providers }
  saveJSON('token-tester-config', migrated)
  return migrated
}

import { inferProviderAdapterId } from '../lib/provider-registry'

export function loadMigratedConfig(): AppConfig {
  return migrateConfig(loadJSON<AppConfig>('token-tester-config', { providers: [] }))
}

export function loadMigratedPricing(): Record<string, { input: number; output: number }> {
  const m = migratePricingKeys(loadJSON<Record<string, { input: number; output: number }>>('token-tester-model-pricing', {}))
  saveJSON('token-tester-model-pricing', m)
  return m
}
