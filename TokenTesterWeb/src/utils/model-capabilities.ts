export type ModelCapability =
  | 'ocr'
  | 'invoice'
  | 'extraction'
  | 'vision'
  | 'reasoning'
  | 'thinking'
  | 'coding'
  | 'fast'
  | 'low-cost'
  | 'long-context'
  | 'audio'
  | 'image-generation'
  | 'legacy'

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  ocr: 'OCR',
  invoice: 'Invoices',
  extraction: 'Extraction',
  vision: 'Vision',
  reasoning: 'Reasoning',
  thinking: 'Thinking',
  coding: 'Coding',
  fast: 'Fast',
  'low-cost': 'Low cost',
  'long-context': 'Long ctx',
  audio: 'Audio',
  'image-generation': 'Image gen',
  legacy: 'Legacy',
}

export const CAPABILITY_STYLES: Record<ModelCapability, string> = {
  ocr: 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  invoice: 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  extraction: 'border-brand-blue/35 bg-brand-blue/10 text-brand-blue dark:border-brand-blue/50 dark:bg-brand-blue/15 dark:text-surface-100',
  vision: 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  reasoning: 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  thinking: 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  coding: 'border-brand-blue/35 bg-brand-blue/10 text-brand-blue dark:border-brand-blue/50 dark:bg-brand-blue/15 dark:text-surface-100',
  fast: 'border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  'low-cost': 'border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  'long-context': 'border-brand-blue/35 bg-brand-blue/10 text-brand-blue dark:border-brand-blue/50 dark:bg-brand-blue/15 dark:text-surface-100',
  audio: 'border-brand-blue/35 bg-brand-blue/10 text-brand-blue dark:border-brand-blue/50 dark:bg-brand-blue/15 dark:text-surface-100',
  'image-generation': 'border-brand-gold/45 bg-brand-gold/15 text-brand-charcoal dark:text-brand-gold',
  legacy: 'border-surface-600 bg-surface-800 text-surface-400',
}

const CAPABILITY_ORDER: ModelCapability[] = [
  'ocr',
  'invoice',
  'extraction',
  'vision',
  'reasoning',
  'thinking',
  'coding',
  'fast',
  'low-cost',
  'long-context',
  'audio',
  'image-generation',
  'legacy',
]

export function inferModelCapabilities(
  modelId: string,
  meta: any,
  pricing: { input: number; output: number }
): ModelCapability[] {
  const id = modelId.toLowerCase()
  const inputModalities = (meta?.inputModalities ?? []).map((m: string) => m.toLowerCase())
  const outputModalities = (meta?.outputModalities ?? []).map((m: string) => m.toLowerCase())
  const modality = String(meta?.modality ?? '').toLowerCase()
  const contextLength = Number(meta?.context_length ?? meta?.contextLength ?? 0)
  const caps = new Set<ModelCapability>()

  const hasVision = inputModalities.includes('image') || modality.includes('image') || /vision|image|vl|omni|gpt-4o|gemini/.test(id)
  if (hasVision) {
    caps.add('vision')
    caps.add('ocr')
    caps.add('invoice')
    caps.add('extraction')
  }
  if (inputModalities.includes('audio') || outputModalities.includes('transcription') || /audio|whisper|transcribe|transcription/.test(id)) caps.add('audio')
  if (/reason|r1|o\d|grok-4|sonnet|opus/.test(id)) caps.add('reasoning')
  if (/thinking|think/.test(id)) caps.add('thinking')
  if (/code|coder|coding|codestral|devstral|grok-build|deepseek-coder|qwen.*coder/.test(id)) caps.add('coding')
  if (/mini|small|haiku|flash|fast|instant|lite|8b|7b/.test(id)) caps.add('fast')
  if (/cheap|free|mini|small|haiku|flash|lite/.test(id) || (pricing.input > 0 && pricing.output > 0 && pricing.input <= 1 && pricing.output <= 3)) caps.add('low-cost')
  if (contextLength >= 128000 || /128k|200k|256k|1m|long/.test(id)) caps.add('long-context')
  if (/image|imagine|dall|stable|flux/.test(id) || outputModalities.includes('image')) caps.add('image-generation')
  if (/extract|parse|json|ocr|invoice|receipt|document/.test(id)) caps.add('extraction')
  if (/legacy|deprecated|preview/.test(id)) caps.add('legacy')
  if (caps.size === 0) caps.add('extraction')

  return CAPABILITY_ORDER.filter(cap => caps.has(cap)).slice(0, 6)
}
