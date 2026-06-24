import type { AttachedFile, TestRun } from '../types'
import { providerCanAcceptAttachment, requiresTextOnlyAttachments } from './provider-capabilities'

export type NormalizedAttachmentKind = 'text' | 'image' | 'document'

export interface NormalizedAttachment {
  kind: NormalizedAttachmentKind
  filename: string
  path?: string
  mimeType?: string
  base64?: string
  text?: string
}

export interface NormalizedRunInput {
  systemPrompt: string
  userMessage: string
  attachments: NormalizedAttachment[]
}

export interface ProviderRef {
  name: string
  type: string
  baseUrl: string
}

function attachmentKind(file: AttachedFile): NormalizedAttachmentKind {
  if (file.type === 'image') return 'image'
  if (file.type === 'document') return 'document'
  return 'text'
}

export function fileToNormalizedAttachment(file: AttachedFile): NormalizedAttachment {
  return {
    kind: attachmentKind(file),
    filename: file.name,
    path: file.path,
    mimeType: file.mimeType,
    base64: file.base64,
    text: file.content,
  }
}

export function filesForRun(run: TestRun) {
  return run.sourceType === 'batch'
    ? (run.batchFiles ?? [])
    : (run.file ? [run.file] : [])
}

export function buildRunInput(run: TestRun): NormalizedRunInput {
  const files = filesForRun(run)
  return {
    systemPrompt: run.systemPrompt,
    userMessage: run.userMessage || defaultUserMessage(run, files),
    attachments: files.map(fileToNormalizedAttachment),
  }
}

export function unsupportedAttachmentReason(provider: ProviderRef, run: TestRun) {
  const unsupported = filesForRun(run).filter(file => {
    if (file.type === 'text') return false
    if (requiresTextOnlyAttachments(provider, run.model)) return true
    return !providerCanAcceptAttachment(provider, run.model, file.type === 'image' ? 'image' : 'document')
  })
  if (unsupported.length === 0) return null
  const names = unsupported.slice(0, 3).map(file => file.name).join(', ')
  const suffix = unsupported.length > 3 ? `, and ${unsupported.length - 3} more` : ''
  return `${provider.name} does not support this attachment type for ${run.model}; skipped unsupported attachment${unsupported.length !== 1 ? 's' : ''}: ${names}${suffix}`
}

function defaultUserMessage(run: TestRun, files: AttachedFile[]) {
  if (files.length === 0) return 'Hello'
  if (files.length === 1) return `Analyze this file: ${files[0].name}`
  return `Analyze the following ${files.length} files:`
}

