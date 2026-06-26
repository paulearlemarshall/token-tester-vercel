import type { ArchivedRunResult } from '../types'
import { webApi } from '../lib/web-api'

export interface ArchiveSlice {
  archivedRecords: ArchivedRunResult[]
  archivedRecordsLoadedAt: number | null
  archivedRecordsLoading: boolean
  archivedRecordsError: string | null
  loadArchivedRecords: (limit?: number, force?: boolean) => Promise<void>
  updateArchivedRecords: (updater: (records: ArchivedRunResult[]) => ArchivedRunResult[]) => void
}

interface ArchiveCrossSlice {
  archivedRecords: ArchivedRunResult[]
  archivedRecordsLoading: boolean
  archivedRecordsLoadedAt: number | null
}

type Get = () => ArchiveCrossSlice

export const createArchiveSlice = (set: any, get: Get): ArchiveSlice => ({
  archivedRecords: [],
  archivedRecordsLoadedAt: null,
  archivedRecordsLoading: false,
  archivedRecordsError: null,
  loadArchivedRecords: async (limit = 5000, force = false) => {
    const state = get()
    if (!force && (state.archivedRecordsLoading || state.archivedRecordsLoadedAt)) return
    set({ archivedRecordsLoading: true, archivedRecordsError: null })
    try {
      const data = await webApi.getArchivedResults(limit)
      set({
        archivedRecords: data.records ?? [],
        archivedRecordsLoadedAt: Date.now(),
        archivedRecordsLoading: false,
      })
    } catch (err: any) {
      set({
        archivedRecordsError: err.message ?? String(err),
        archivedRecordsLoading: false,
      })
    }
  },
  updateArchivedRecords: (updater) => set((s: any) => ({
    archivedRecords: updater(s.archivedRecords),
    archivedRecordsLoadedAt: Date.now(),
  })),
})
