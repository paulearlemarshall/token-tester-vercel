import type { NormalizedAttachment, NormalizedRunInput } from './run-input'

export function audioFormatForChatCompletion(attachment: NormalizedAttachment) {
  const ext = attachment.filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'oga' || ext === 'opus') return 'ogg'
  if (ext) return ext
  const mimeType = attachment.mimeType?.toLowerCase() ?? ''
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('aiff') || mimeType.includes('aifc')) return 'aiff'
  if (mimeType.includes('aac')) return 'aac'
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg'
  if (mimeType.includes('flac')) return 'flac'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

export function textWithAttachmentLabels(input: NormalizedRunInput) {
  const labels = input.attachments
    .filter(a => a.kind !== 'text')
    .map(a => `\n--- ${a.filename} ---`)
    .join('')
  const textAttachments = input.attachments
    .filter(a => a.kind === 'text' && a.text)
    .map(a => `\n--- ${a.filename} ---\n\`\`\`\n${a.text}\n\`\`\``)
    .join('')
  return `${input.userMessage || 'Hello'}${labels}${textAttachments}`
}

function imageContent(attachment: NormalizedAttachment) {
  return { type: 'image_url' as const, image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` } }
}

function documentContent(attachment: NormalizedAttachment) {
  return { type: 'file' as const, file: { filename: attachment.filename, file_data: `data:${attachment.mimeType};base64,${attachment.base64}` } }
}

function audioContent(attachment: NormalizedAttachment) {
  return { type: 'input_audio' as const, input_audio: { data: attachment.base64, format: audioFormatForChatCompletion(attachment) } }
}

export function needsCompletionTokens(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model) || model.toLowerCase().includes('reasoning')
}

export function hasAudioAttachments(input: NormalizedRunInput): boolean {
  return input.attachments.some(a => a.kind === 'audio')
}

export function hasNonAudioBinaryAttachments(input: NormalizedRunInput): boolean {
  return input.attachments.some(a => a.kind !== 'audio' && a.kind !== 'text')
}

export function buildChatCompatMessages(input: NormalizedRunInput) {
  const messages: any[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  const hasParts = input.attachments.some(a => (a.kind === 'image' || a.kind === 'document' || a.kind === 'audio') && a.base64)
  if (hasParts) {
    const content: any[] = [{ type: 'text', text: textWithAttachmentLabels(input) }]
    for (const attachment of input.attachments) {
      if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
        content.push(imageContent(attachment))
      } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
        content.push(documentContent(attachment))
      } else if (attachment.kind === 'audio' && attachment.base64) {
        content.push(audioContent(attachment))
      }
    }
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: textWithAttachmentLabels(input) })
  }
  return messages
}

export function buildOpenAICompatMessages(input: NormalizedRunInput) {
  const messages: any[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  const content: any[] = [{ type: 'text', text: textWithAttachmentLabels(input) }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      content.push(imageContent(attachment))
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      content.push(documentContent(attachment))
    }
  }
  messages.push({ role: 'user', content })
  return messages
}

export function buildOpenAIMessages(input: NormalizedRunInput) {
  const messages: any[] = []
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt })
  const content: any[] = [{ type: 'text', text: input.userMessage || 'Hello' }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      content.push(imageContent(attachment))
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      content.push(documentContent(attachment))
    } else if (attachment.kind === 'audio' && attachment.base64) {
      content.push(audioContent(attachment))
    }
  }
  messages.push({ role: 'user', content })
  return messages
}

export function buildResponsesInput(input: NormalizedRunInput) {
  const parts: any[] = [{ type: 'input_text', text: textWithAttachmentLabels(input) }]
  for (const attachment of input.attachments) {
    if (attachment.kind === 'image' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.base64}` })
    } else if (attachment.kind === 'document' && attachment.base64 && attachment.mimeType) {
      parts.push({ type: 'input_file', filename: attachment.filename, file_data: `data:${attachment.mimeType};base64,${attachment.base64}` })
    } else if (attachment.kind === 'audio' && attachment.base64) {
      parts.push({ type: 'input_audio', data: attachment.base64, format: audioFormatForChatCompletion(attachment) })
    }
  }
  return [{ role: 'user', content: parts }]
}
