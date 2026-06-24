export {
  getAttachmentCapabilities,
  providerIsDocumentCapable,
  type AttachmentCapabilities,
  type ProviderLike,
} from './provider-registry'

import { getAttachmentCapabilities } from './provider-registry'
import type { ProviderLike } from './provider-registry'

export function supportsImageAttachments(provider: ProviderLike) {
  return getAttachmentCapabilities(provider).supportsImages
}

export function supportsDocumentAttachments(provider: ProviderLike) {
  return getAttachmentCapabilities(provider).supportsDocuments
}

export function requiresTextOnlyAttachments(provider: ProviderLike, model?: string) {
  return getAttachmentCapabilities(provider, model).requiresTextOnlyAttachments
}

export function providerCanAcceptAttachment(provider: ProviderLike, model: string, attachmentType: 'image' | 'document' | 'audio' | 'video' | 'text') {
  const capabilities = getAttachmentCapabilities(provider, model)
  if (attachmentType === 'text') return true
  if (capabilities.requiresTextOnlyAttachments) return false
  if (attachmentType === 'image') return capabilities.supportsImages
  if (attachmentType === 'document') return capabilities.supportsDocuments
  if (attachmentType === 'audio') return capabilities.supportsAudio
  if (attachmentType === 'video') return capabilities.supportsVideo
  return false
}
