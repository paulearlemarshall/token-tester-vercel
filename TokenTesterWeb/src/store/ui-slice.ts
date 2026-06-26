import type { TabId, ThemeMode } from '../types'
import { loadThemeMode, saveJSON } from './helpers'

export interface UISlice {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const createUISlice = (set: any): UISlice => ({
  activeTab: 'configure',
  setActiveTab: (tab) => set({ activeTab: tab }),
  themeMode: loadThemeMode(),
  setThemeMode: (mode) => {
    saveJSON('token-tester-theme-mode', mode)
    set({ themeMode: mode })
  },
})
