import { Settings, FileText, Play, BarChart3, Monitor, Moon, Sun, Archive, Boxes } from 'lucide-react'
import { useStore } from '../../store'
import type { TabId, ThemeMode } from '../../types'

const NAV: { id: TabId; label: string; icon: typeof Settings }[] = [
  { id: 'configure', label: 'Configure', icon: Settings },
  { id: 'prompts', label: 'Prompts & Files', icon: FileText },
  { id: 'models', label: 'Models', icon: Boxes },
  { id: 'run', label: 'Run', icon: Play },
  { id: 'results', label: 'Results', icon: BarChart3 },
  { id: 'archive', label: 'Results Archive', icon: Archive },
  { id: 'modelStats', label: 'Model Stats', icon: BarChart3 },
]

export function Sidebar({ activeTab, onSelect }: { activeTab: TabId; onSelect: (t: TabId) => void }) {
  const themeMode = useStore((s) => s.themeMode)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const themeOptions: { mode: ThemeMode; label: string; icon: typeof Monitor }[] = [
    { mode: 'system', label: 'System', icon: Monitor },
    { mode: 'light', label: 'Light', icon: Sun },
    { mode: 'dark', label: 'Dark', icon: Moon },
  ]

  return (
    <aside className="w-56 bg-surface-900 border-r border-surface-700 flex flex-col shrink-0">
      <div className="p-4 border-b border-surface-700">
        <h1 className="text-lg font-bold text-brand-gold tracking-tight">Token Tester</h1>
        <p className="text-xs text-surface-400 mt-0.5">LLM Benchmark Harness</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === id
                ? 'bg-brand-blue/15 text-brand-blue border border-brand-blue/40 dark:text-brand-gold dark:border-brand-gold/40 dark:bg-brand-gold/10'
                : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border border-transparent'
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-surface-700 space-y-3">
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <div className="w-2 h-2 rounded-full bg-brand-gold" />
          v1.0.0
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-surface-700 bg-surface-850 p-1" aria-label="Theme mode">
          {themeOptions.map(({ mode, label, icon: Icon }) => {
            const active = themeMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setThemeMode(mode)}
                aria-pressed={active}
                title={`${label} theme`}
                className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold ${
                  active
                    ? 'bg-brand-navy text-white dark:bg-brand-gold dark:text-brand-charcoal'
                    : 'text-surface-400 hover:bg-surface-800 hover:text-surface-100'
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
