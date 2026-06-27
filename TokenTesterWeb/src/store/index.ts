import { create } from 'zustand'
import type { UISlice } from './ui-slice'
import type { ConfigSlice } from './config-slice'
import type { PromptsSlice } from './prompts-slice'
import type { PricingSlice } from './pricing-slice'
import type { QueueSlice } from './queue-slice'
import type { ArchiveSlice } from './archive-slice'
import type { LogSlice } from './log-slice'
import { createUISlice } from './ui-slice'
import { createConfigSlice } from './config-slice'
import { createPromptsSlice } from './prompts-slice'
import { createPricingSlice } from './pricing-slice'
import { createQueueSlice } from './queue-slice'
import { createArchiveSlice } from './archive-slice'
import { createLogSlice } from './log-slice'

export type AppState =
  & UISlice
  & ConfigSlice
  & PromptsSlice
  & PricingSlice
  & QueueSlice
  & ArchiveSlice
  & LogSlice

export const useStore = create<AppState>()((set, get) => ({
  ...createUISlice(set),
  ...createConfigSlice(set, get),
  ...createPromptsSlice(set, get),
  ...createPricingSlice(set, get),
  ...createQueueSlice(set),
  ...createArchiveSlice(set, get),
  ...createLogSlice(set),
}))
