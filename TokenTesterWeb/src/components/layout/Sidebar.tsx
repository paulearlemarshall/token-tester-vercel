import { Settings, FileText, Play, BarChart3, Moon, Sun } from 'lucide-react'
import { useStore } from '../../store'
import type { TabId } from '../../types'

const NAV: { id: TabId; label: string; icon: typeof Settings }[] = [
  { id: 'configure', label: 'Configure', icon: Settings },
  { id: 'prompts', label: 'Prompts & Files', icon: FileText },
  { id: 'run', label: 'Run', icon: Play },
  { id: 'results', label: 'Results', icon: BarChart3 },
]

export function Sidebar({ activeTab, onSelect }: { activeTab: TabId; onSelect: (t: TabId) => void }) {
  const darkMode = useStore((s) => s.darkMode)
  const toggleDarkMode = useStore((s) => s.toggleDarkMode)

  return (
    <aside className="w-56 bg-surface-900 border-r border-surface-700 flex flex-col shrink-0">
      <div className="p-4 border-b border-surface-700">
        <h1 className="text-lg font-bold text-blue-400 tracking-tight">Token Tester</h1>
        <p className="text-xs text-surface-400 mt-0.5">LLM Benchmark Harness</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === id
                ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30'
                : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border border-transparent'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-surface-700 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          v1.0.0
        </div>
        <button
          onClick={toggleDarkMode}
          className="p-1.5 rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  )
}
