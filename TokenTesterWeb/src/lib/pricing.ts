import models from '../data/models.json'
import { getSql } from './db'

type NestedPricing = Record<string, Record<string, { input: number; output: number; per?: string }>>
type FlatPricing = Record<string, { input: number; output: number; per: string }>

export interface ModelPriceInput {
  serviceProvider: string
  modelId: string
  input: number
  output: number
  upstreamProvider?: string | null
  displayName?: string | null
  source?: string
}

export function flattenPricing(nested: NestedPricing = models as NestedPricing) {
  const flat: FlatPricing = {}
  for (const [provider, providerModels] of Object.entries(nested)) {
    for (const [model, pricing] of Object.entries(providerModels)) {
      if (pricing.input < 0 || pricing.output < 0) continue
      flat[`${provider}/${model}`] = { ...pricing, per: pricing.per ?? '1M' }
    }
  }
  return flat
}

export async function getPricing() {
  const fallback = flattenPricing()
  try {
    const sql = getSql()
    const rows = await sql`
      select service_provider, model_id, input_per_1m, output_per_1m
      from model_prices
      order by service_provider, model_id
    `
    const dbPricing: FlatPricing = {}
    for (const row of rows as any[]) {
      dbPricing[`${row.service_provider}/${row.model_id}`] = {
        input: Number(row.input_per_1m),
        output: Number(row.output_per_1m),
        per: '1M',
      }
    }
    return { ...fallback, ...dbPricing }
  } catch {
    return fallback
  }
}

export async function upsertModelPrice(input: ModelPriceInput) {
  const serviceProvider = normalizeServiceProvider(input.serviceProvider)
  const modelId = input.modelId.trim()
  if (!serviceProvider || !modelId) {
    throw new Error('serviceProvider and modelId are required')
  }
  if (!Number.isFinite(input.input) || !Number.isFinite(input.output) || input.input < 0 || input.output < 0) {
    throw new Error('input and output prices must be non-negative numbers')
  }

  const sql = getSql()
  await sql`
    insert into model_prices (
      service_provider,
      model_id,
      upstream_provider,
      display_name,
      input_per_1m,
      output_per_1m,
      source,
      updated_at
    )
    values (
      ${serviceProvider},
      ${modelId},
      ${input.upstreamProvider ?? inferUpstreamProvider(serviceProvider, modelId)},
      ${input.displayName ?? modelId},
      ${input.input},
      ${input.output},
      ${input.source ?? 'manual'},
      now()
    )
    on conflict (service_provider, model_id) do update set
      upstream_provider = excluded.upstream_provider,
      display_name = excluded.display_name,
      input_per_1m = excluded.input_per_1m,
      output_per_1m = excluded.output_per_1m,
      source = excluded.source,
      updated_at = now()
  `
  return {
    key: `${serviceProvider}/${modelId}`,
    price: { input: input.input, output: input.output, per: '1M' },
  }
}

export function normalizeServiceProvider(value: string) {
  return value.trim().toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function inferUpstreamProvider(serviceProvider: string, modelId: string) {
  if (serviceProvider === 'openrouter' && modelId.includes('/')) {
    return modelId.split('/')[0]
  }
  return serviceProvider
}
