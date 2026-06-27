import type { TabId, ThemeMode } from '../types'
import { loadJSON, loadThemeMode, saveJSON } from './helpers'

export interface UISlice {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  parallelEnabled: boolean
  setParallelEnabled: (enabled: boolean) => void
  parallelJobs: number
  setParallelJobs: (jobs: number) => void
}

export const createUISlice = (set: any): UISlice => ({
  activeTab: 'configure',
  setActiveTab: (tab) => set({ activeTab: tab }),
  themeMode: loadThemeMode(),
  setThemeMode: (mode) => {
    saveJSON('token-tester-theme-mode', mode)
    set({ themeMode: mode })
  },
  parallelEnabled: loadJSON<boolean>('token-tester-parallel-enabled', false),
  setParallelEnabled: (enabled) => {
    saveJSON('token-tester-parallel-enabled', enabled)
    set({ parallelEnabled: enabled })
  },
  parallelJobs: loadJSON<number>('token-tester-parallel-jobs', 1),
  setParallelJobs: (jobs) => {
    saveJSON('token-tester-parallel-jobs', jobs)
    set({ parallelJobs: jobs })
  },
})
