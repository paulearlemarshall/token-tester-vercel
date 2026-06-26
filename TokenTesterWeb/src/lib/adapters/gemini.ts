import { textWithAttachmentLabels } from '../message-builders'
import type { NormalizedRunInput } from '../run-input'
import type { ApiResult } from './shared'

export const ADAPTER_ID = 'gemini' as const

export async function adapterDispatch(
  apiKey: string, model: string, input: NormalizedRunInput, maxTokens: number
): Promise<ApiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const body = { contents: [{ role: 'user', parts: buildGeminiParts(input) }], generationConfig: { maxOutputTokens: maxTokens } }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    responseText: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    requestPayload: body,
    requestUrl: url,
    responsePayload: data,
  }
}

function buildGeminiParts(input: NormalizedRunInput): any[] {
  const parts: any[] = []
  if (input.systemPrompt) parts.push({ text: input.systemPrompt })
  parts.push({ text: textWithAttachmentLabels(input) })
  for (const attachment of input.attachments) {
    if ((attachment.kind === 'image' || attachment.kind === 'document' || attachment.kind === 'audio' || attachment.kind === 'video') && attachment.base64 && attachment.mimeType) {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } })
    }
  }
  return parts
}
