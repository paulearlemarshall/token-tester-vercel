import type { NormalizedRunInput } from '../run-input'
import { buildResponsesInput, buildOpenAIMessages } from '../message-builders'
import type { ApiResult } from './shared'
import { parseHeaders, shouldUseTranscription } from './shared'
import { chatOpenAICompat } from './openai-compat'

export const ADAPTER_ID = 'openai' as const

function hasAudioAttachments(input: NormalizedRunInput) {
  return input.attachments.some(a => a.kind === 'audio')
}

export async function adapterDispatch(
  baseUrl: string, apiKey: string, model: string, input: NormalizedRunInput,
  maxTokens: number, extraHeaders?: string,
  modelMetas?: { id: string; outputModalities?: string[] }[]
): Promise<ApiResult> {
  return shouldUseTranscription(model, input, modelMetas)
    ? await transcribeOpenAI(baseUrl, apiKey, model, input, extraHeaders)
    : hasAudioAttachments(input)
      ? await chatOpenAICompat(baseUrl, apiKey, model, input, maxTokens, extraHeaders, buildOpenAIMessages)
      : await chatOpenAIResponses(baseUrl, apiKey, model, input, maxTokens, extraHeaders)
}

async function transcribeOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: NormalizedRunInput,
  extraHeaders?: string
): Promise<ApiResult> {
  const audioAttachments = input.attachments.filter(a => a.kind === 'audio' && a.base64)
  if (audioAttachments.length === 0) throw new Error('OpenAI transcription requires at least one audio attachment')

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`
  const extra = parseHeaders(extraHeaders)
  const transcriptionResults: { filename: string; data: any }[] = []

  for (const attachment of audioAttachments) {
    if (!attachment.base64 || !attachment.mimeType) {
      throw new Error(`OpenAI audio attachment "${attachment.filename}" is missing base64 data or mime type`)
    }
    const formData = new FormData()
    formData.append('model', model)
    formData.append('file', new Blob([Buffer.from(attachment.base64, 'base64') as BlobPart], { type: attachment.mimeType }), attachment.filename)

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, ...extra },
      body: formData,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
    }

    transcriptionResults.push({ filename: attachment.filename, data: await res.json() })
  }

  const responseText = transcriptionResults.map((t) => {
    const text = typeof t.data?.text === 'string' ? t.data.text : ''
    if (transcriptionResults.length === 1) return text
    return `--- ${t.filename} ---\n${text}`
  }).filter(Boolean).join('\n\n')

  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    responseText,
    error: responseText ? undefined : 'OpenAI transcription returned no text. Inspect the raw response payload for details.',
    requestPayload: { model, transcriptionCount: audioAttachments.length },
    requestUrl: url,
    responsePayload: transcriptionResults,
  }
}

async function chatOpenAIResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: NormalizedRunInput,
  maxTokens: number,
  extraHeaders?: string
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/responses`
  const extra = parseHeaders(extraHeaders)
  const body: any = { model, input: buildResponsesInput(input), max_output_tokens: maxTokens }
  if (input.systemPrompt) body.instructions = input.systemPrompt

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
  const responseText = parseOpenAIResponsesText(data)
  return {
    inputTokens: data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? ((data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0) + (data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0)),
    responseText,
    error: !responseText ? 'Provider returned no text content. Inspect the raw response payload for details.' : undefined,
    requestPayload: body,
    requestUrl: url,
    responsePayload: data,
  }
}

function parseOpenAIResponsesText(data: any): string {
  const lastMessage = Array.isArray(data?.output) ? data.output.at(-1) : null
  const content = Array.isArray(lastMessage?.content) ? lastMessage.content : []
  const textPart = content.find((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
  return textPart?.text ?? ''
}
