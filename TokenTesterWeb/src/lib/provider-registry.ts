import type { ProviderAdapterId, ProviderConfig, ProviderType } from '../types'

export interface ProviderLike {
  name?: string
  type: ProviderType | string
  baseUrl: string
  adapterId?: ProviderAdapterId
}

export interface AttachmentCapabilities {
  supportsImages: boolean
  supportsDocuments: boolean
  requiresTextOnlyAttachments: boolean
}

export interface ProviderAdapter {
  id: ProviderAdapterId
  protocol: ProviderType
  canonicalProviderKey: string
  capabilities: AttachmentCapabilities
}

const ADAPTERS: Record<ProviderAdapterId, ProviderAdapter> = {
  openai: {
    id: 'openai',
    protocol: 'openai-compat',
    canonicalProviderKey: 'openai',
    capabilities: { supportsImages: true, supportsDocuments: true, requiresTextOnlyAttachments: false },
  },
  openrouter: {
    id: 'openrouter',
    protocol: 'openai-compat',
    canonicalProviderKey: 'openrouter',
    capabilities: { supportsImages: true, supportsDocuments: true, requiresTextOnlyAttachments: false },
  },
  xai: {
    id: 'xai',
    protocol: 'openai-compat',
    canonicalProviderKey: 'xai',
    capabilities: { supportsImages: true, supportsDocuments: true, requiresTextOnlyAttachments: false },
  },
  anthropic: {
    id: 'anthropic',
    protocol: 'anthropic',
    canonicalProviderKey: 'anthropic',
    capabilities: { supportsImages: true, supportsDocuments: true, requiresTextOnlyAttachments: false },
  },
  gemini: {
    id: 'gemini',
    protocol: 'gemini',
    canonicalProviderKey: 'google',
    capabilities: { supportsImages: true, supportsDocuments: true, requiresTextOnlyAttachments: false },
  },
  deepseek: {
    id: 'deepseek',
    protocol: 'openai-compat',
    canonicalProviderKey: 'deepseek',
    capabilities: { supportsImages: true, supportsDocuments: false, requiresTextOnlyAttachments: true },
  },
  mistral: {
    id: 'mistral',
    protocol: 'openai-compat',
    canonicalProviderKey: 'mistral',
    capabilities: { supportsImages: true, supportsDocuments: false, requiresTextOnlyAttachments: false },
  },
  'ssnc-ai-gateway': {
    id: 'ssnc-ai-gateway',
    protocol: 'openai-compat',
    canonicalProviderKey: 'ssc-ai-gateway',
    capabilities: { supportsImages: true, supportsDocuments: false, requiresTextOnlyAttachments: false },
  },
  'custom-openai-compatible': {
    id: 'custom-openai-compatible',
    protocol: 'openai-compat',
    canonicalProviderKey: 'custom',
    capabilities: { supportsImages: true, supportsDocuments: false, requiresTextOnlyAttachments: false },
  },
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

export function inferProviderAdapterId(provider: ProviderLike): ProviderAdapterId {
  if (provider.adapterId && ADAPTERS[provider.adapterId]) return provider.adapterId

  const name = normalize(provider.name ?? '')
  const baseUrl = normalize(provider.baseUrl)
  const type = normalize(provider.type)

  if (type === 'anthropic' || baseUrl.includes('api.anthropic.com') || name.includes('anthropic')) return 'anthropic'
  if (type === 'gemini' || baseUrl.includes('generativelanguage.googleapis.com') || name.includes('gemini')) return 'gemini'
  if (baseUrl.includes('openrouter.ai') || name.includes('openrouter')) return 'openrouter'
  if (baseUrl.includes('api.x.ai') || name === 'xai' || name.includes('grok')) return 'xai'
  if (baseUrl.includes('api.deepseek.com') || name.includes('deepseek')) return 'deepseek'
  if (baseUrl.includes('api.mistral.ai') || name.includes('mistral')) return 'mistral'
  if (baseUrl.includes('ssnc-corp.cloud') || name.includes('ss&c') || name.includes('ssnc')) return 'ssnc-ai-gateway'
  if (baseUrl.includes('api.openai.com') || name === 'openai') return 'openai'
  return 'custom-openai-compatible'
}

export function getProviderAdapter(provider: ProviderLike): ProviderAdapter {
  return ADAPTERS[inferProviderAdapterId(provider)]
}

export function withInferredAdapter<T extends ProviderLike>(provider: T): T & { adapterId: ProviderAdapterId } {
  return { ...provider, adapterId: inferProviderAdapterId(provider) }
}

export function getAttachmentCapabilities(provider: ProviderLike, model?: string): AttachmentCapabilities {
  const adapter = getProviderAdapter(provider)
  const normalizedModel = normalize(model ?? '')
  if (normalizedModel.includes('deepseek')) {
    return { ...adapter.capabilities, supportsDocuments: false, requiresTextOnlyAttachments: true }
  }
  return adapter.capabilities
}

export function providerIsDocumentCapable(provider: ProviderConfig) {
  return getAttachmentCapabilities(provider).supportsDocuments
}
