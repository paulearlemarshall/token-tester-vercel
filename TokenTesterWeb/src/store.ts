import { create } from 'zustand'
import type { AppConfig, AttachedFile, DebugEntry, FileItem, PromptEntry, ProviderConfig, TabId, TestRun } from './types'
import { PROVIDER_PRESETS } from './utils/constants'

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
function saveJSON(key: string, val: any) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
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

interface AppState {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void

  config: AppConfig
  initFromPreset: (presetName: string) => void
  addProvider: (p: ProviderConfig) => void
  updateProvider: (id: string, u: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void

  systemPrompt: string
  setSystemPrompt: (p: string) => void

  customPrompts: PromptEntry[]
  addPrompt: (text?: string) => void
  updatePrompt: (id: string, u: Partial<PromptEntry>) => void
  removePrompt: (id: string) => void

  fileItems: FileItem[]
  addFileItem: (item: FileItem) => void
  removeFileItem: (id: string) => void
  updateFileItem: (id: string, u: Partial<FileItem>) => void
  toggleFileEnabled: (itemId: string, fileId: string) => void
  clearFileItems: () => void

  modelScope: Record<string, Record<string, boolean>>
  setModelScope: (providerId: string, modelId: string, inScope: boolean) => void
  toggleAllModels: (providerId: string, inScope: boolean) => void

  modelPricing: Record<string, { input: number; output: number }>
  setModelPricing: (key: string, input: number, output: number) => void

  builtinPricing: Record<string, { input: number; output: number; per: string }>
  loadBuiltinPricing: (data: Record<string, { input: number; output: number; per: string }>) => void

  queue: TestRun[]
  setQueue: (q: TestRun[]) => void
  updateRun: (id: string, u: Partial<TestRun>) => void
  clearQueue: () => void

  debugEntries: DebugEntry[]
  pushDebugEntry: (e: DebugEntry) => void
  clearDebugEntries: () => void

  isRunning: boolean
  setIsRunning: (v: boolean) => void

  darkMode: boolean
  toggleDarkMode: () => void
}

export const useStore = create<AppState>((set, get) => ({
  activeTab: 'configure',
  setActiveTab: (tab) => set({ activeTab: tab }),

  config: loadJSON<AppConfig>('token-tester-config', { providers: [] }),

  initFromPreset: (presetName) => {
    const preset = PROVIDER_PRESETS.find((p: any) => p.name === presetName)
    if (!preset) return
    const { providers } = get().config
    if (providers.some((p: ProviderConfig) => p.name === preset.name)) return
    const newProv: ProviderConfig = {
      id: crypto.randomUUID(),
      name: preset.name,
      type: preset.type,
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

  systemPrompt: loadJSON<string>('token-tester-system-prompt', ''),
  setSystemPrompt: (p) => { set({ systemPrompt: p }); saveJSON('token-tester-system-prompt', p) },

  customPrompts: loadJSON<PromptEntry[]>('token-tester-custom-prompts', []),
  addPrompt: (text) => {
    const entry: PromptEntry = { id: crypto.randomUUID(), text: text ?? '', enabled: true }
    const updated = [...get().customPrompts, entry]
    set({ customPrompts: updated })
    saveJSON('token-tester-custom-prompts', updated)
  },
  updatePrompt: (id, u) => {
    const updated = get().customPrompts.map((p: PromptEntry) => p.id === id ? { ...p, ...u } : p)
    set({ customPrompts: updated })
    saveJSON('token-tester-custom-prompts', updated)
  },
  removePrompt: (id) => {
    const updated = get().customPrompts.filter((p: PromptEntry) => p.id !== id)
    set({ customPrompts: updated })
    saveJSON('token-tester-custom-prompts', updated)
  },

  fileItems: [],
  addFileItem: (item) => set((s) => ({ fileItems: [...s.fileItems, item] })),
  removeFileItem: (id) => set((s) => ({ fileItems: s.fileItems.filter((f: FileItem) => f.id !== id) })),
  updateFileItem: (id, u) => set((s) => ({
    fileItems: s.fileItems.map((f: FileItem) => f.id === id ? { ...f, ...u } : f),
  })),
  toggleFileEnabled: (itemId, fileId) => set((s) => ({
    fileItems: s.fileItems.map((f: FileItem) =>
      f.id === itemId && f.files
        ? { ...f, files: f.files.map((ff: AttachedFile) => ff.id === fileId ? { ...ff, enabled: !ff.enabled } : ff) }
        : f
    ),
  })),
  clearFileItems: () => set({ fileItems: [] }),

  modelScope: {},
  setModelScope: (providerId, modelId, inScope) => set((s) => {
    const current = s.modelScope[providerId] ?? {}
    return { modelScope: { ...s.modelScope, [providerId]: { ...current, [modelId]: inScope } } }
  }),
  toggleAllModels: (providerId, inScope) => set((s) => {
    const prov = s.config.providers.find((p: ProviderConfig) => p.id === providerId)
    if (!prov) return s
    const all: Record<string, boolean> = {}
    prov.models.forEach((m: string) => { all[m] = inScope })
    return { modelScope: { ...s.modelScope, [providerId]: all } }
  }),

  modelPricing: (() => { const m = migratePricingKeys(loadJSON<Record<string, { input: number; output: number }>>('token-tester-model-pricing', {})); saveJSON('token-tester-model-pricing', m); return m })(),
  setModelPricing: (key, input, output) => set((s) => {
    const next = { ...s.modelPricing, [key]: { input, output } }
    saveJSON('token-tester-model-pricing', next)
    return { modelPricing: next, builtinPricing: { ...s.builtinPricing, [key]: { input, output, per: '1M' } } }
  }),

  builtinPricing: {},
  loadBuiltinPricing: (data) => set({ builtinPricing: data }),

  queue: [],
  setQueue: (q) => set({ queue: q }),
  updateRun: (id, u) => set((s) => ({
    queue: s.queue.map((r: TestRun) => r.id === id ? { ...r, ...u } : r),
  })),
  clearQueue: () => set({ queue: [] }),

  debugEntries: [],
  pushDebugEntry: (e) => set((s) => ({ debugEntries: [e, ...s.debugEntries].slice(0, 50) })),
  clearDebugEntries: () => set({ debugEntries: [] }),

  isRunning: false,
  setIsRunning: (v) => set({ isRunning: v }),

  darkMode: loadJSON<boolean>('token-tester-dark-mode', true),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode
    saveJSON('token-tester-dark-mode', next)
    return { darkMode: next }
  }),
}))
