import type { ProviderPreset } from '../types'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'OpenAI',
    type: 'openai-compat',
    baseUrl: 'https://api.openai.com',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    name: 'OpenRouter',
    type: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.0-flash', 'meta-llama/llama-3.1-70b-instruct'],
  },
  {
    name: 'SS&C AI Gateway',
    type: 'openai-compat',
    baseUrl: 'https://gov-ai-us.ssnc-corp.cloud',
    apiKeyEnv: 'SSC_CLOUD_API_KEY',
    models: ['meta-llama/Llama-3.3-70B-Instruct'],
    headers: 'OpenAI-Project: <your-use-case-id>',
  },
  {
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-4', 'claude-3-haiku'],
  },
  {
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  {
    name: 'DeepSeek',
    type: 'openai-compat',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    name: 'Mistral',
    type: 'openai-compat',
    baseUrl: 'https://api.mistral.ai',
    apiKeyEnv: 'MISTRAL_API_KEY',
    models: ['mistral-large-latest', 'mistral-small-latest'],
  },
  {
    name: 'Groq',
    type: 'openai-compat',
    baseUrl: 'https://api.groq.com/openai',
    apiKeyEnv: 'GROQ_API_KEY',
    models: ['mixtral-8x7b-32768', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
  },
]

export const PROVIDER_LOGOS: Record<string, string> = {
  OpenAI: '🤖',
  OpenRouter: '🔀',
  'SS&C AI Gateway': '🏢',
  Anthropic: '🧠',
  'Google Gemini': '✨',
  DeepSeek: '🌊',
  Mistral: '🌬️',
  Groq: '⚡',
}
