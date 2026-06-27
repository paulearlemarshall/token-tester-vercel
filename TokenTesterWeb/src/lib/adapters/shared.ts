import type { LogEntry } from '../api-logger'
import type { NormalizedRunInput } from '../run-input'

export interface ApiResult {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  responseText: string
  error?: string
  requestPayload?: unknown
  requestUrl?: string
  responsePayload?: unknown
  logs?: LogEntry[]
}

export function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  const headers: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (k && v) headers[k] = v
  }
  return headers
}

export function modelHasOutputModality(model: string, modelMetas: { id: string; outputModalities?: string[] }[] | undefined, modality: string) {
  const meta = modelMetas?.find(item => item.id === model)
  const outputModalities = meta?.outputModalities?.map(item => item.toLowerCase()) ?? []
  return outputModalities.includes(modality.toLowerCase())
}

export function shouldUseTranscription(model: string, input: NormalizedRunInput, modelMetas?: { id: string; outputModalities?: string[] }[]) {
  const audioAttachments = input.attachments.filter(attachment => attachment.kind === 'audio')
  if (audioAttachments.length === 0) return false
  const hasNonAudioBinary = input.attachments.some(attachment => attachment.kind !== 'audio' && attachment.kind !== 'text')
  if (hasNonAudioBinary) return false
  return modelHasOutputModality(model, modelMetas, 'transcription') || /(?:^|\/)(whisper|gpt-4o-transcribe|gpt-4o-mini-transcribe)/i.test(model)
}
