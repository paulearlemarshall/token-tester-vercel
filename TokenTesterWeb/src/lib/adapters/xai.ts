import type { NormalizedAttachment, NormalizedRunInput } from '../run-input'
import { textWithAttachmentLabels } from '../message-builders'
import type { ApiResult } from './shared'
import { parseHeaders } from './shared'

export const ADAPTER_ID = 'xai' as const

export async function adapterDispatch(
  baseUrl: string, apiKey: string, model: string, inputRun: NormalizedRunInput,
  maxTokens: number, extraHeaders?: string
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/responses`
  const { inputRun: responseInput, transcriptions } = await transcribeXaiAudioAttachments(inputRun, baseUrl, apiKey, extraHeaders)
  const input = await buildXaiResponsesInput(responseInput, baseUrl, apiKey, extraHeaders)
  const extra = parseHeaders(extraHeaders)
  const body = { model, input, max_output_tokens: maxTokens }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  const { inputTokens, outputTokens, totalTokens } = parseXaiUsage(data)
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    responseText: parseXaiResponseText(data),
    requestPayload: transcriptions.length > 0
      ? { stt: transcriptions.map(t => t.requestPayload), responses: body }
      : body,
    requestUrl: url,
    responsePayload: transcriptions.length > 0
      ? { stt: transcriptions.map(t => t.responsePayload), responses: data }
      : data,
  }
}

function parseXaiResponseText(data: any): string {
  const lastMessage = Array.isArray(data?.output) ? data.output.at(-1) : null
  const content = Array.isArray(lastMessage?.content) ? lastMessage.content : []
  const textPart = content.find((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
  return textPart?.text ?? ''
}

function parseXaiUsage(data: any) {
  const inputTokens = data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0
  const outputTokens = data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0
  const totalTokens = data?.usage?.total_tokens ?? (inputTokens + outputTokens)
  return { inputTokens, outputTokens, totalTokens }
}

async function buildXaiResponsesInput(
  inputRun: NormalizedRunInput,
  baseUrl: string,
  apiKey: string,
  extraHeaders?: string
): Promise<any[]> {
  const fileIdCache = new Map<string, Promise<string>>()
  const input: any[] = []
  if (inputRun.systemPrompt) input.push({ role: 'system', content: inputRun.systemPrompt })

  const parts: any[] = [{ type: 'input_text', text: textWithAttachmentLabels(inputRun) }]
  for (const attachment of inputRun.attachments) {
    if (attachment.kind === 'document') {
      if (!attachment.base64 || !attachment.mimeType) throw new Error('xAI document attachments must include base64 data and mime type')
      const cacheKey = `${attachment.filename}:${attachment.mimeType}:${attachment.base64.length}:${attachment.base64.slice(0, 32)}`
      let uploadPromise = fileIdCache.get(cacheKey)
      if (!uploadPromise) {
        uploadPromise = uploadXaiFile(baseUrl, apiKey, attachment.filename, attachment.mimeType, attachment.base64, extraHeaders)
        fileIdCache.set(cacheKey, uploadPromise)
      }
      const fileId = await uploadPromise
      parts.push({ type: 'input_file', file_id: fileId })
    } else if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.base64}` })
    }
  }
  input.push({ role: 'user', content: parts })

  return input
}

async function uploadXaiFile(
  baseUrl: string,
  apiKey: string,
  filename: string,
  mimeType: string,
  base64Data: string,
  extraHeaders?: string
): Promise<string> {
  const uploadUrl = `${baseUrl.replace(/\/+$/, '')}/v1/files`
  const body = new FormData()
  body.append('file', new Blob([Buffer.from(base64Data, 'base64')], { type: mimeType }), filename)
  const extra = parseHeaders(extraHeaders)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...extra },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  const data = await res.json()
  if (!data?.id) throw new Error('xAI file upload did not return a file id')
  return data.id
}

interface XaiAudioTranscription {
  filename: string
  text: string
  requestPayload: unknown
  responsePayload: unknown
}

async function transcribeXaiAudioAttachment(
  baseUrl: string,
  apiKey: string,
  attachment: NormalizedAttachment,
  extraHeaders?: string
): Promise<XaiAudioTranscription> {
  if (!attachment.base64 || !attachment.mimeType) {
    throw new Error(`xAI audio attachment "${attachment.filename}" must include base64 data and mime type`)
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/stt`
  const body = new FormData()
  body.append('format', 'true')
  body.append('language', 'en')
  body.append('file', new Blob([Buffer.from(attachment.base64, 'base64')], { type: attachment.mimeType }), attachment.filename)
  const extra = parseHeaders(extraHeaders)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...extra },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  const transcript = typeof data?.text === 'string' ? data.text : ''
  if (!transcript) throw new Error(`xAI STT returned no transcript for "${attachment.filename}"`)

  return {
    filename: attachment.filename,
    text: transcript,
    requestPayload: { url, filename: attachment.filename, mimeType: attachment.mimeType, format: true, language: 'en' },
    responsePayload: data,
  }
}

async function transcribeXaiAudioAttachments(
  inputRun: NormalizedRunInput,
  baseUrl: string,
  apiKey: string,
  extraHeaders?: string
) {
  const audioAttachments = inputRun.attachments.filter(a => a.kind === 'audio')
  if (audioAttachments.length === 0) {
    return { inputRun, transcriptions: [] as XaiAudioTranscription[] }
  }

  const transcriptions = await Promise.all(
    audioAttachments.map(a => transcribeXaiAudioAttachment(baseUrl, apiKey, a, extraHeaders))
  )
  return {
    inputRun: {
      ...inputRun,
      attachments: [
        ...inputRun.attachments.filter(a => a.kind !== 'audio'),
        ...transcriptions.map(t => ({
          kind: 'text' as const,
          filename: `${t.filename} transcript`,
          text: t.text,
        })),
      ],
    },
    transcriptions,
  }
}
