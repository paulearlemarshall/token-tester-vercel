import { useState } from 'react'
import { Plus, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, RefreshCw, Loader2, FileEdit, DollarSign, X, Copy, Check } from 'lucide-react'
import { useStore } from '../store'
import { PROVIDER_PRESETS, PROVIDER_LOGOS } from '../utils/constants'
import type { ProviderAdapterId, ProviderConfig, ProviderType } from '../types'
import { webApi } from '../lib/web-api'
import { PricingNavigator } from './PricingNavigator'
import { canonicalProviderKey } from '../lib/provider-key'

export function ConfigureTab() {
  const { config, initFromPreset, addProvider, updateProvider, removeProvider } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [fetching, setFetching] = useState<string | null>(null)
  const [fetchedOk, setFetchedOk] = useState<Record<string, boolean>>({})
  const [fetchDialog, setFetchDialog] = useState<null | {
    provider: string
    ok: boolean
    title: string
    responseText: string
    results?: { provider: string; ok: boolean; responseText: string; modelCount?: number; error?: string }[]
  }>(null)
  const [responseCollapsed, setResponseCollapsed] = useState(true)
  const [copiedResponse, setCopiedResponse] = useState(false)
  const [showPricingNavigator, setShowPricingNavigator] = useState(false)
  const responseJson = (() => {
    if (!fetchDialog?.responseText) return null
    try {
      return JSON.parse(fetchDialog.responseText)
    } catch {
      return null
    }
  })()
  const responsePreview = responseJson
    ? Array.isArray(responseJson)
      ? `Array(${responseJson.length})`
      : `Object(${Object.keys(responseJson).length} keys)`
    : `${fetchDialog?.responseText?.length ?? 0} chars`

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function highlightJson(text: string): string {
    const tokenRegex = /("(?:\\.|[^"\\])*"|\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:])/gi
    let lastIndex = 0
    let out = ''

    for (let match = tokenRegex.exec(text); match; match = tokenRegex.exec(text)) {
      out += escapeHtml(text.slice(lastIndex, match.index))
      const token = match[0]
      if (token.startsWith('"')) {
        const next = text[tokenRegex.lastIndex]
        const keyClass = next === ':' ? 'text-brand-gold' : 'text-brand-blue dark:text-brand-gold'
        out += `<span class="${keyClass}">${escapeHtml(token)}</span>`
      } else if (token === 'true' || token === 'false' || token === 'null') {
        out += `<span class="text-fuchsia-300">${token}</span>`
      } else if (/^\d/.test(token) || /^-/.test(token)) {
        out += `<span class="text-brand-blue dark:text-brand-gold">${token}</span>`
      } else {
        out += `<span class="text-surface-500">${escapeHtml(token)}</span>`
      }
      lastIndex = tokenRegex.lastIndex
    }

    out += escapeHtml(text.slice(lastIndex))
    return out
  }

  const unusedPresets = PROVIDER_PRESETS.filter(
    (pre: any) => !config.providers.some((p: any) => p.name === pre.name)
  )

  function handleAddPreset(presetName: string) {
    initFromPreset(presetName)
    setShowAdd(false)
  }

  function handleAddCustom() {
    const newProv: ProviderConfig = {
      id: crypto.randomUUID(),
      name: 'Custom',
      type: 'openai-compat',
      adapterId: 'custom-openai-compatible',
      baseUrl: 'https://api.openai.com',
      apiKeyEnv: 'CUSTOM_API_KEY',
      models: ['gpt-4o'],
      enabled: true,
    }
    addProvider(newProv)
    setExpanded(newProv.id)
    setShowAdd(false)
  }

  async function saveFetchedPricing(prov: ProviderConfig, result: any) {
    if (!result.pricing) return
    const providerKey = canonicalProviderKey(prov)
    for (const [modelId, p] of Object.entries(result.pricing) as [string, {input: number; output: number}][]) {
      const rawModel = result.rawModels?.[modelId] ?? null
      useStore.getState().setModelPricing(`${providerKey}/${modelId}`, p.input, p.output)
      webApi.savePricing({
        serviceProvider: providerKey,
        modelId,
        input: p.input,
        output: p.output,
        displayName: modelId,
        source: 'provider-discovery',
        sourcePriority: 100,
        rawProviderPayload: rawModel ?? {
          provider: prov.name,
          baseUrl: prov.baseUrl,
          modelId,
          pricing: p,
        },
        matchStatus: 'matched',
        matchConfidence: 1,
        matchMethod: 'provider-model-id',
        matchEvidence: {
          source: 'provider-discovery',
          provider: prov.name,
          serviceProvider: providerKey,
          modelId,
          providerModelId: modelId,
          reason: 'Price came from the same provider model discovery row used to populate the model list.',
        },
      }).catch(err => console.error('Failed to save fetched pricing', err))
    }
  }

  async function fetchAndApplyModels(prov: ProviderConfig) {
    const result = await webApi.fetchModels({
      type: prov.type,
      adapterId: prov.adapterId,
      baseUrl: prov.baseUrl,
      apiKeyEnv: prov.apiKeyEnv,
      headers: prov.headers,
    })
    if (!result.models?.length) {
      throw new Error(result.error || 'No models returned')
    }
    updateProvider(prov.id, { models: result.models, modelMetas: result.modelMetas })
    await saveFetchedPricing(prov, result)
    return result
  }

  async function updateActiveProviderModels() {
    const activeProviders = config.providers.filter((prov: ProviderConfig) => prov.enabled)
    if (activeProviders.length === 0) {
      setFetchDialog({
        provider: 'Active providers',
        ok: false,
        title: 'No active providers to update',
        responseText: 'Enable at least one provider before updating models.',
      })
      return
    }
    setFetching('all')
    const results = []
    for (const prov of activeProviders) {
      try {
        const result = await fetchAndApplyModels(prov)
        setFetchedOk(s => ({ ...s, [prov.id]: true }))
        results.push({
          provider: prov.name,
          ok: true,
          modelCount: result.models?.length ?? 0,
          responseText: result.responseText || JSON.stringify(result, null, 2),
        })
      } catch (err: any) {
        setFetchedOk(s => ({ ...s, [prov.id]: false }))
        results.push({
          provider: prov.name,
          ok: false,
          error: err.message ?? String(err),
          responseText: err.message ?? String(err),
        })
      }
    }
    const okCount = results.filter(result => result.ok).length
    setFetchDialog({
      provider: `${activeProviders.length} active provider${activeProviders.length === 1 ? '' : 's'}`,
      ok: okCount === results.length,
      title: `Updated models: ${okCount}/${results.length} succeeded`,
      responseText: JSON.stringify(results, null, 2),
      results,
    })
    setFetching(null)
  }

  async function copyFetchResponse() {
    if (!fetchDialog?.responseText) return
    try {
      await navigator.clipboard.writeText(fetchDialog.responseText)
      setCopiedResponse(true)
      setTimeout(() => setCopiedResponse(false), 1200)
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-surface-100">Provider Configuration</h2>
          <p className="text-sm text-surface-400 mt-1">Add API providers and select models to test</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs flex items-center gap-1.5" title="Configure provider secrets in Vercel environment variables.">
            <FileEdit size={14} />
            Vercel Env
          </button>
          <button
            onClick={() => setShowPricingNavigator(true)}
            className="btn-secondary text-xs flex items-center gap-1.5"
            title="Inspect provider/model prices, source context, and matching evidence."
          >
            <DollarSign size={14} />
            Pricing
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add Provider
          </button>
          <button
            onClick={updateActiveProviderModels}
            disabled={fetching !== null}
            className="btn-secondary flex items-center gap-2"
          >
            {fetching === 'all' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Update Models
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-surface-300">Add a provider</h3>
          {unusedPresets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unusedPresets.map(pre => (
                <button
                  key={pre.name}
                  onClick={() => handleAddPreset(pre.name)}
                  className="btn-secondary flex items-center gap-2 text-xs"
                >
                  <span>{PROVIDER_LOGOS[pre.name] ?? '🔌'}</span>
                  {pre.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-surface-400">
            <span className="flex-1 border-t border-surface-700" />
            <span>or</span>
            <span className="flex-1 border-t border-surface-700" />
          </div>
          <button onClick={handleAddCustom} className="btn-secondary text-xs w-full">
            Custom Provider (manual setup)
          </button>
        </div>
      )}

      {config.providers.length === 0 && !showAdd && (
        <div className="card text-center py-12">
          <p className="text-surface-400">No providers configured yet.</p>
          <p className="text-surface-500 text-sm mt-1">Click "Add Provider" to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {config.providers.map((prov: any) => (
          <div key={prov.id} className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{PROVIDER_LOGOS[prov.name] ?? '🔌'}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-surface-100">{prov.name}</span>
                    <span className="badge-blue text-[10px]">{prov.type}</span>
                    {!prov.enabled && <span className="badge-gray text-[10px]">disabled</span>}
                  </div>
                  <p className="text-xs text-surface-400 mt-0.5">{prov.baseUrl}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateProvider(prov.id, { enabled: !prov.enabled })}
                  className="text-surface-400 hover:text-surface-200 transition-colors"
                  title={prov.enabled ? 'Disable' : 'Enable'}
                >
                  {prov.enabled ? <ToggleRight size={20} className="text-brand-gold" /> : <ToggleLeft size={20} />}
                </button>
                <button
                  onClick={() => setExpanded(expanded === prov.id ? null : prov.id)}
                  className="text-surface-400 hover:text-surface-200 transition-colors"
                >
                  {expanded === prov.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                <button
                  onClick={() => removeProvider(prov.id)}
                  className="text-surface-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {expanded === prov.id && (
              <div className="mt-4 pt-4 border-t border-surface-700 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Provider Name</label>
                    <input
                      className="input"
                      value={prov.name}
                      onChange={e => updateProvider(prov.id, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <select
                      className="input"
                      value={prov.type}
                      onChange={e => updateProvider(prov.id, { type: e.target.value as ProviderType })}
                    >
                      <option value="openai-compat">OpenAI Compatible</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">Adapter</label>
                    <select
                      className="input"
                      value={prov.adapterId ?? 'custom-openai-compatible'}
                      onChange={e => updateProvider(prov.id, { adapterId: e.target.value as ProviderAdapterId })}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="xai">xAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="mistral">Mistral</option>
                      <option value="ssnc-ai-gateway">SS&C AI Gateway</option>
                      <option value="custom-openai-compatible">Custom OpenAI-compatible</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">Base URL</label>
                    <input
                      className="input font-mono text-xs"
                      value={prov.baseUrl}
                      onChange={e => updateProvider(prov.id, { baseUrl: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="label">API Key (env var name)</label>
                    <input
                      className="input font-mono text-xs"
                      value={prov.apiKeyEnv}
                      onChange={e => updateProvider(prov.id, { apiKeyEnv: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Extra Headers <span className="text-surface-500 font-normal">(one per line: Key: Value)</span></label>
                    <textarea
                      className="input font-mono text-xs"
                      rows={2}
                      placeholder="OpenAI-Project: my-project-id"
                      value={prov.headers ?? ''}
                      onChange={e => updateProvider(prov.id, { headers: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="label mb-0">Models</label>
                      <button
                        onClick={async () => {
                          setFetching(prov.id)
                          try {
                            const result = await fetchAndApplyModels(prov)
                            setFetchedOk(s => ({ ...s, [prov.id]: true }))
                            setFetchDialog({
                              provider: prov.name,
                              ok: true,
                              title: `Fetched models for ${prov.name}`,
                              responseText: result.responseText || JSON.stringify(result, null, 2),
                            })
                          } catch (err: any) {
                            setFetchedOk(s => ({ ...s, [prov.id]: false }))
                            setFetchDialog({
                              provider: prov.name,
                              ok: false,
                              title: `Fetch failed for ${prov.name}`,
                              responseText: err.message ?? String(err),
                            })
                          }
                          setFetching(null)
                        }}
                        disabled={fetching !== null}
                        className={`text-xs flex items-center gap-1 ${fetchedOk[prov.id] ? 'btn-success' : 'btn-secondary'}`}
                      >
                        {fetching === prov.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        Fetch Models
                      </button>
                    </div>
                    <textarea
                      className="input font-mono text-xs"
                      rows={4}
                      placeholder="One model ID per line. Click 'Fetch Models' to pull from the provider API."
                      value={prov.models.join('\n')}
                      onChange={e => updateProvider(prov.id, { models: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {fetchDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => {
            setFetchDialog(null)
            setResponseCollapsed(true)
            setCopiedResponse(false)
          }}
        >
          <div
            className={`w-full max-w-4xl overflow-hidden rounded-2xl border shadow-2xl ${
              fetchDialog.ok ? 'border-brand-blue/50 bg-surface-950 dark:border-brand-gold/45' : 'border-red-900/60 bg-surface-950'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex items-start justify-between border-b px-5 py-4 ${fetchDialog.ok ? 'border-brand-blue/30 bg-brand-blue/10 dark:border-brand-gold/30 dark:bg-brand-gold/10' : 'border-red-900/40 bg-red-950/20'}`}>
              <div className="space-y-1">
                <div className={`text-sm font-semibold ${fetchDialog.ok ? 'text-brand-blue dark:text-brand-gold' : 'text-red-300'}`}>{fetchDialog.title}</div>
                <div className="text-xs text-surface-400 font-mono">{fetchDialog.provider}</div>
              </div>
              <button
                onClick={() => {
                  setFetchDialog(null)
                  setResponseCollapsed(true)
                  setCopiedResponse(false)
                }}
                className="text-surface-400 hover:text-surface-200"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {fetchDialog.results && (
                <div className="space-y-2">
                  {fetchDialog.results.map(result => {
                    const parsed = (() => {
                      try { return JSON.parse(result.responseText) } catch { return null }
                    })()
                    const body = parsed ? JSON.stringify(parsed, null, 2) : result.responseText
                    return (
                      <details key={result.provider} className={`overflow-hidden rounded-xl border ${result.ok ? 'border-brand-blue/30 bg-brand-blue/5 dark:border-brand-gold/30 dark:bg-brand-gold/5' : 'border-red-900/50 bg-red-950/20'}`}>
                        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
                          <span className={result.ok ? 'text-surface-200' : 'text-red-200'}>
                            {result.provider}
                            <span className="ml-2 text-xs text-surface-500">
                              {result.ok ? `${result.modelCount ?? 0} models` : result.error}
                            </span>
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${result.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                            {result.ok ? 'success' : 'fail'}
                          </span>
                        </summary>
                        <pre className="max-h-72 overflow-auto border-t border-surface-800 p-4 text-xs font-mono leading-relaxed text-surface-200 whitespace-pre-wrap break-all">
                          {body}
                        </pre>
                      </details>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setResponseCollapsed(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-surface-300 hover:text-surface-100"
                >
                  {responseCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  Response
                </button>
                <button
                  onClick={copyFetchResponse}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                  disabled={!fetchDialog.responseText}
                >
                  {copiedResponse ? <Check size={14} className="text-brand-gold" /> : <Copy size={14} />}
                  {copiedResponse ? 'Copied' : 'Copy response'}
                </button>
              </div>
              <div className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900/70">
                <button
                  onClick={() => setResponseCollapsed(v => !v)}
                  className="flex w-full items-center justify-between gap-3 border-b border-surface-800 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    {responseCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <span className="text-xs font-semibold text-surface-200">Response</span>
                    <span className="text-[10px] text-surface-500">{responsePreview}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-surface-500">
                    {responseCollapsed ? 'Collapsed' : 'Expanded'}
                  </span>
                </button>
                {!responseCollapsed && (
                  <div className="max-h-[58vh] overflow-auto p-4">
                    {responseJson ? (
                      <pre
                        className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all"
                        dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(responseJson, null, 2)) }}
                      />
                    ) : (
                      <pre className="text-xs font-mono leading-relaxed text-surface-200 whitespace-pre-wrap break-all">
                        {fetchDialog.responseText}
                      </pre>
                    )}
                  </div>
                )}
                {responseCollapsed && (
                  <div className="px-4 py-3 text-sm text-surface-400">
                    Expand to inspect the full provider payload.
                  </div>
                )}
              </div>
              <div className={`rounded-xl border px-4 py-3 text-sm ${fetchDialog.ok ? 'border-brand-blue/40 bg-brand-blue/10 text-brand-navy dark:border-brand-gold/40 dark:bg-brand-gold/10 dark:text-brand-gold' : 'border-red-900/50 bg-red-950/20 text-red-200'}`}>
                {fetchDialog.ok ? 'Fetch succeeded.' : fetchDialog.responseText}
              </div>
            </div>
          </div>
        </div>
      )}
      {showPricingNavigator && <PricingNavigator onClose={() => setShowPricingNavigator(false)} />}
    </div>
  )
}
