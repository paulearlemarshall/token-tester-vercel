import { textWithAttachmentLabels } from '../message-builders'
import type { NormalizedRunInput } from '../run-input'
import type { ApiResult } from './shared'

export const ADAPTER_ID = 'anthropic' as const

export async function adapterDispatch(
  apiKey: string, model: string, input: NormalizedRunInput, maxTokens: number
): Promise<ApiResult> {
  const body: any = {
    model,
    messages: [{ role: 'user', content: buildAnthropicContent(input) }],
    max_tokens: maxTokens,
  }
  if (input.systemPrompt) body.system = input.systemPrompt

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    responseText: data.content?.[0]?.text ?? '',
    requestPayload: body,
    requestUrl: 'https://api.anthropic.com/v1/messages',
    responsePayload: data,
  }
}

function buildAnthropicContent(input: NormalizedRunInput): any[] {
  const parts: any[] = [{ type: 'text', text: textWithAttachmentLabels(input) }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 } })
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'document', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 } })
    }
  }
  return parts
}
