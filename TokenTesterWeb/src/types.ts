export type ProviderType = 'openai-compat' | 'anthropic' | 'gemini'

export interface ModelMeta {
  id: string
  created?: number
  owned_by?: string
  context_length?: number
  modality?: string
}

export interface ProviderConfig {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  apiKeyEnv: string
  models: string[]
  modelMetas?: ModelMeta[]
  enabled: boolean
  headers?: string
}

export interface PromptEntry {
  id: string
  text: string
  enabled: boolean
}

export interface AttachedFile {
  id: string
  name: string
  path: string
  size: number
  ext: string
  type: 'text' | 'image' | 'document' | 'unknown'
  content?: string
  base64?: string
  mimeType?: string
  enabled?: boolean
  metadata?: Record<string, string>
}

export interface FileItem {
  id: string
  kind: 'file' | 'folder'
  name: string
  path: string
  prompt: string
  size: number
  fileCount: number
  file?: AttachedFile
  files?: AttachedFile[]
  mode: 'batch' | 'single'
}

export interface ChatResult {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  responseText: string
  latencyMs: number
  error?: string
}

export interface TestRun {
  id: string
  providerId: string
  providerName: string
  model: string
  sourceLabel: string
  sourceType: 'prompt' | 'file' | 'batch'
  systemPrompt: string
  userMessage: string
  file: AttachedFile | null
  batchFiles?: AttachedFile[]
  status: 'queued' | 'running' | 'success' | 'error' | 'skipped'
  result?: ChatResult
  localInputTokens?: number
  timestamp: number
  priceOverride?: { input: number; output: number }
}

export type TabId = 'configure' | 'prompts' | 'run' | 'results'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface PriceEntry {
  input: number
  output: number
  per: string
}

export interface DebugEntry {
  provider: string
  model: string
  request: any
  response: any
  error?: string
  file?: string
  filePath?: string
  inputTokens?: number
  outputTokens?: number
  latency?: number
}

export interface AppConfig {
  providers: ProviderConfig[]
}

export interface ProviderPreset {
  name: string
  type: ProviderType
  baseUrl: string
  apiKeyEnv: string
  models: string[]
  headers?: string
}
