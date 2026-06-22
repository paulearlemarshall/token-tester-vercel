import { useEffect, useCallback } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/layout/Sidebar'
import { ConfigureTab } from './components/ConfigureTab'
import { PromptsTab } from './components/PromptsTab'
import { RunTab } from './components/RunTab'
import { ResultsTab } from './components/ResultsTab'

declare global { interface Window { electronAPI: any } }

export default function App() {
  const { activeTab, setActiveTab, darkMode, loadBuiltinPricing, setModelPricing } = useStore()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  const reloadPricing = useCallback(async () => {
    const builtin = await window.electronAPI?.getPricing()
    if (builtin) loadBuiltinPricing(builtin)
  }, [loadBuiltinPricing])

  useEffect(() => {
    reloadPricing()
    const onFocus = () => reloadPricing()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadPricing])

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
