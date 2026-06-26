import type { NormalizedRunInput } from '../run-input'
import { buildOpenAICompatMessages, needsCompletionTokens } from '../message-builders'
import type { ApiResult } from './shared'
import { parseHeaders } from './shared'

export async function chatOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: NormalizedRunInput,
  maxTokens: number,
  extraHeaders?: string,
  messageBuilder: (input: NormalizedRunInput) => unknown[] = buildOpenAICompatMessages
): Promise<ApiResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const extra = parseHeaders(extraHeaders)
  const body: any = { model, messages: messageBuilder(input), max_tokens: maxTokens }
  if (/^gpt-audio/i.test(model)) {
    body.modalities = ['text']
  }
  if (needsCompletionTokens(model)) {
    delete body.max_tokens
    body.max_completion_tokens = maxTokens
  }

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
  const error = providerErrorMessage(data)
  const responseText = extractOpenAICompatText(data)
  return {
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? ((data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0) + (data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0)),
    responseText,
    error: error || (!responseText ? 'Provider returned no text content. Inspect the raw response payload for details.' : undefined),
    requestPayload: body,
    requestUrl: url,
    responsePayload: data,
  }
}

function providerErrorMessage(data: any) {
  const error = data?.error
  if (!error) return ''
  if (typeof error === 'string') return error
  return [error.message, error.code, error.type].filter(Boolean).join(' · ') || JSON.stringify(error)
}

function extractOpenAICompatText(data: any) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null
  const message = choice?.message ?? choice?.delta ?? choice
  const candidates = [
    message?.content,
    message?.audio?.transcript,
    message?.text,
    message?.reasoning,
    message?.refusal,
    choice?.text,
    data?.output_text,
    data?.response,
  ]
  for (const candidate of candidates) {
    const text = contentToText(candidate)
    if (text) return text
  }
  return ''
}

function contentToText(value: any): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(part => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.content === 'string') return part.content
      if (typeof part?.reasoning === 'string') return part.reasoning
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
