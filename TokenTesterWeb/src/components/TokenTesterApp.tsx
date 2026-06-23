'use client'

import { useEffect, useEffectEvent } from 'react'
import { useStore } from '../store'
import { Sidebar } from './layout/Sidebar'
import { ConfigureTab } from './ConfigureTab'
import { PromptsTab } from './PromptsTab'
import { RunTab } from './RunTab'
import { ResultsTab } from './ResultsTab'
import { webApi } from '../lib/web-api'

export function TokenTesterApp() {
  const { activeTab, setActiveTab, themeMode, loadBuiltinPricing } = useStore()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolvedDark = themeMode === 'dark' || (themeMode === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', resolvedDark)
      document.documentElement.dataset.themeMode = themeMode
      document.documentElement.style.colorScheme = resolvedDark ? 'dark' : 'light'
    }
    applyTheme()
    if (themeMode !== 'system') return
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themeMode])

  const reloadPricing = useEffectEvent(async () => {
    const builtin = await webApi.getPricing()
    loadBuiltinPricing(builtin)
  })

  useEffect(() => {
    reloadPricing()
    window.addEventListener('focus', reloadPricing)
    return () => window.removeEventListener('focus', reloadPricing)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar activeTab={activeTab} onSelect={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'configure' && <ConfigureTab />}
        {activeTab === 'prompts' && <PromptsTab />}
        {activeTab === 'run' && <RunTab />}
        {activeTab === 'results' && <ResultsTab />}
      </main>
    </div>
  )
}
