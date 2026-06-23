import type { ProviderConfig } from '../types'

export interface ProviderLike {
  name: string
  type: string
  baseUrl: string
}

export interface AttachmentCapabilities {
  supportsImages: boolean
  supportsDocuments: boolean
  requiresTextOnlyAttachments: boolean
}

export function getAttachmentCapabilities(provider: ProviderLike, model?: string): AttachmentCapabilities {
  const normalizedName = provider.name.trim().toLowerCase()
  const normalizedBaseUrl = provider.baseUrl.trim().toLowerCase()
  const normalizedModel = (model ?? '').trim().toLowerCase()
  const isDeepSeek = normalizedName.includes('deepseek') || normalizedBaseUrl.includes('api.deepseek.com') || normalizedModel.includes('deepseek')
  const isOpenRouter = normalizedName.includes('openrouter') || normalizedBaseUrl.includes('openrouter.ai')
  const isXai = normalizedName.includes('xai') || normalizedBaseUrl.includes('api.x.ai')

  return {
    supportsImages: provider.type === 'openai-compat' || provider.type === 'anthropic' || provider.type === 'gemini',
    supportsDocuments:
      provider.type === 'anthropic'
      || provider.type === 'gemini'
      || isOpenRouter
      || isXai
      || (provider.type === 'openai-compat' && normalizedBaseUrl.includes('api.openai.com')),
    requiresTextOnlyAttachments: isDeepSeek,
  }
}

export function supportsImageAttachments(provider: ProviderLike) {
  return getAttachmentCapabilities(provider).supportsImages
}

export function supportsDocumentAttachments(provider: ProviderLike) {
  return getAttachmentCapabilities(provider).supportsDocuments
}

export function requiresTextOnlyAttachments(provider: ProviderLike, model?: string) {
  return getAttachmentCapabilities(provider, model).requiresTextOnlyAttachments
}

export function providerCanAcceptAttachment(provider: ProviderLike, model: string, attachmentType: 'image' | 'document' | 'text') {
  const capabilities = getAttachmentCapabilities(provider, model)
  if (attachmentType === 'text') return true
  if (capabilities.requiresTextOnlyAttachments) return false
  if (attachmentType === 'image') return capabilities.supportsImages
  if (attachmentType === 'document') return capabilities.supportsDocuments
  return false
}

export function providerIsDocumentCapable(provider: ProviderConfig) {
  return getAttachmentCapabilities(provider).supportsDocuments
}
