import { buildChatCompatMessages, audioFormatForChatCompletion } from '../message-builders'
import type { NormalizedRunInput } from '../run-input'
import type { ApiResult } from './shared'
import { parseHeaders, shouldUseTranscription } from './shared'
import { chatOpenAICompat } from './openai-compat'

export const ADAPTER_ID = 'openrouter' as const

export async function adapterDispatch(
  baseUrl: string, apiKey: string, model: string, input: NormalizedRunInput,
  maxTokens: number, extraHeaders?: string, modelMetas?: { id: string; outputModalities?: string[] }[]
): Promise<ApiResult> {
  return shouldUseTranscription(model, input, modelMetas)
    ? await transcribeOpenRouterAudio(baseUrl, apiKey, model, input, extraHeaders)
    : await chatOpenAICompat(baseUrl, apiKey, model, input, maxTokens, extraHeaders, buildChatCompatMessages)
}

async function transcribeOpenRouterAudio(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: NormalizedRunInput,
  extraHeaders?: string
): Promise<ApiResult> {
  const audioAttachments = input.attachments.filter(a => a.kind === 'audio' && a.base64)
  if (audioAttachments.length === 0) throw new Error('OpenRouter transcription requires at least one audio attachment')

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`
  const extra = parseHeaders(extraHeaders)
  const requests = audioAttachments.map(a => ({
    model,
    input_audio: { data: a.base64, format: audioFormatForChatCompletion(a) },
  }))
  const responses = []
  for (const body of requests) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
    }
    responses.push(await res.json())
  }

  const responseText = responses.map((response, index) => {
    const text = typeof response?.text === 'string' ? response.text : ''
    if (responses.length === 1) return text
    return `--- ${audioAttachments[index]?.filename ?? `audio ${index + 1}`} ---\n${text}`
  }).filter(Boolean).join('\n\n')
  const usage = responses.reduce((sum, response) => {
    const item = response?.usage ?? {}
    return {
      inputTokens: sum.inputTokens + (item.input_tokens ?? 0),
      outputTokens: sum.outputTokens + (item.output_tokens ?? 0),
      totalTokens: sum.totalTokens + (item.total_tokens ?? 0),
    }
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 })

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens || (usage.inputTokens + usage.outputTokens),
    responseText,
    error: responseText ? undefined : 'OpenRouter transcription returned no text. Inspect the raw response payload for details.',
    requestPayload: requests.length === 1 ? requests[0] : requests,
    requestUrl: url,
    responsePayload: responses.length === 1 ? responses[0] : responses,
  }
}
