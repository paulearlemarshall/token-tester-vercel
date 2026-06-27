export interface LogEntry {
  id: string
  timestamp: string
  caller: string
  method: string
  url: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  status?: number
  responseHeaders?: Record<string, string>
  responseBody?: string
  durationMs?: number
  error?: string
}

export interface LogSlice {
  logs: LogEntry[]
  addLogs: (entries: LogEntry[]) => void
  clearLogs: () => void
}

export const createLogSlice = (set: any): LogSlice => ({
  logs: [],
  addLogs: (entries) => set((s: any) => ({ logs: [...entries, ...s.logs].slice(0, 200) })),
  clearLogs: () => set({ logs: [] }),
})