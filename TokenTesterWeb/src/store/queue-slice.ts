import type { DebugEntry, TestRun } from '../types'

export interface QueueSlice {
  isRunning: boolean
  setIsRunning: (v: boolean) => void
  queue: TestRun[]
  setQueue: (q: TestRun[]) => void
  updateRun: (id: string, u: Partial<TestRun>) => void
  clearQueue: () => void
  debugEntries: DebugEntry[]
  pushDebugEntry: (e: DebugEntry) => void
  removeDebugEntry: (runId: string) => void
  clearDebugEntries: () => void
}

export const createQueueSlice = (set: any): QueueSlice => ({
  isRunning: false,
  setIsRunning: (v) => set({ isRunning: v }),

  queue: [],
  setQueue: (q) => set({ queue: q }),
  updateRun: (id, u) => set((s: any) => ({
    queue: s.queue.map((r: TestRun) => r.id === id ? { ...r, ...u } : r),
  })),
  clearQueue: () => set({ queue: [] }),

  debugEntries: [],
  pushDebugEntry: (e) => set((s: any) => {
    if (!e.runId) return { debugEntries: [...s.debugEntries, e].slice(-50) }
    const existingIndex = s.debugEntries.findIndex((entry: DebugEntry) => entry.runId === e.runId)
    if (existingIndex === -1) return { debugEntries: [...s.debugEntries, e].slice(-50) }
    const next = [...s.debugEntries]
    next[existingIndex] = e
    return { debugEntries: next }
  }),
  removeDebugEntry: (runId) => set((s: any) => ({
    debugEntries: s.debugEntries.filter((entry: DebugEntry) => entry.runId !== runId),
  })),
  clearDebugEntries: () => set({ debugEntries: [] }),
})
