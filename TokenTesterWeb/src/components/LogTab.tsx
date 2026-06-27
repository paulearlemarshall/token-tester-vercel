import { LogViewer } from './LogViewer'

export function LogTab() {
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-surface-100">API Log</h2>
        <p className="text-sm text-surface-400 mt-1">Every outbound API request and response, captured automatically.</p>
      </div>
      <div className="flex-1 min-h-0">
        <LogViewer />
      </div>
    </div>
  )
}
