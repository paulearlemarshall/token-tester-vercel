import type { FileItem, PromptEntry } from '../types'
import { loadJSON, saveJSON } from './helpers'

export interface PromptsSlice {
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
}

type Get = () => { customPrompts: PromptEntry[]; fileItems: FileItem[] }

export const createPromptsSlice = (set: any, get: Get): PromptsSlice => ({
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
  addFileItem: (item) => set((s: any) => ({ fileItems: [...s.fileItems, item] })),
  removeFileItem: (id) => set((s: any) => ({ fileItems: s.fileItems.filter((f: FileItem) => f.id !== id) })),
  updateFileItem: (id, u) => set((s: any) => ({
    fileItems: s.fileItems.map((f: FileItem) => f.id === id ? { ...f, ...u } : f),
  })),
  toggleFileEnabled: (itemId, fileId) => set((s: any) => ({
    fileItems: s.fileItems.map((f: FileItem) =>
      f.id === itemId && f.files
        ? { ...f, files: f.files.map((ff: any) => ff.id === fileId ? { ...ff, enabled: !ff.enabled } : ff) }
        : f
    ),
  })),
  clearFileItems: () => set({ fileItems: [] }),
})
