import { getSql } from './db'
import { nextLocalId, readLocalJson, shouldUseLocalPersistence, writeLocalJson } from './local-persistence'

type FlatPricing = Record<string, { input: number; output: number; per: string }>

export interface ModelPriceInput {
  serviceProvider: string
  modelId: string
  input: number
  output: number
  upstreamProvider?: string | null
  displayName?: string | null
  source?: string
  sourcePriority?: number
  sourceUrl?: string | null
  sourceUpdatedAt?: string | null
  rawSourcePayload?: unknown
  rawProviderPayload?: unknown
  matchStatus?: string
  matchConfidence?: number | null
  matchMethod?: string | null
  matchEvidence?: unknown
}

export interface PriceRecord {
  id?: number
  key: string
  serviceProvider: string
  modelId: string
  upstreamProvider: string | null
  displayName: string | null
  input: number
  output: number
  currency: string
  source: string
  sourcePriority: number
  sourceUrl: string | null
  sourceUpdatedAt: string | null
  rawSourcePayload: unknown
  rawProviderPayload: unknown
  matchStatus: string
  matchConfidence: number | null
  matchMethod: string | null
  matchEvidence: unknown
  updatedAt: string
  lastSeenAt: string
}

export interface DeletePriceRecordInput {
  id?: number
  serviceProvider?: string
  modelId?: string
  source?: string
}

let pricingSchemaReady = false

async function ensurePricingSchema() {
  if (pricingSchemaReady) return
  const sql = getSql()
  await sql`CREATE SCHEMA IF NOT EXISTS pricing`
  // Migrate old public tables
  const [pricesTables, recordsTables] = await Promise.all([
    (await sql`
      SELECT table_schema FROM information_schema.tables
      WHERE table_name = 'model_prices' AND table_schema IN ('pricing', 'public')
    `) as any[],
    (await sql`
      SELECT table_schema FROM information_schema.tables
      WHERE table_name = 'model_price_records' AND table_schema IN ('pricing', 'public')
    `) as any[],
  ])
  const pricesPublic = pricesTables.some((r: any) => r.table_schema === 'public')
  const pricesPricing = pricesTables.some((r: any) => r.table_schema === 'pricing')
  const recordsPublic = recordsTables.some((r: any) => r.table_schema === 'public')
  const recordsPricing = recordsTables.some((r: any) => r.table_schema === 'pricing')
  if (pricesPublic && !pricesPricing) {
    await sql`ALTER TABLE public.model_prices SET SCHEMA pricing`
  }
  if (recordsPublic && !recordsPricing) {
    await sql`ALTER TABLE public.model_price_records SET SCHEMA pricing`
  }
  pricingSchemaReady = true
}

export async function getPricing() {
  if (shouldUseLocalPersistence()) return getLocalPricing()
  const sql = getSql()
  await ensurePricingSchema()
  const rows = await sql`
    with candidates as (
      select
        service_provider,
        model_id,
        input_per_1m,
        output_per_1m,
        source_priority,
        updated_at
      from pricing.model_price_records
      union all
      select
        service_provider,
        model_id,
        input_per_1m,
        output_per_1m,
        0 as source_priority,
        updated_at
      from pricing.model_prices
      where not exists (
        select 1
        from pricing.model_price_records r
        where r.service_provider = pricing.model_prices.service_provider
          and r.model_id = pricing.model_prices.model_id
      )
    )
    select distinct on (service_provider, model_id)
      service_provider,
      model_id,
      input_per_1m,
      output_per_1m
    from candidates
    order by service_provider, model_id, source_priority desc, updated_at desc
  `
  const dbPricing: FlatPricing = {}
  for (const row of rows as any[]) {
    dbPricing[`${row.service_provider}/${row.model_id}`] = {
      input: Number(row.input_per_1m),
      output: Number(row.output_per_1m),
      per: '1M',
    }
  }
  return dbPricing
}

export async function getPricingRecords() {
  if (shouldUseLocalPersistence()) return getLocalPricingRecords()
  const sql = getSql()
  await ensurePricingSchema()
  const rows = await sql`
    with records as (
      select
        id,
        service_provider,
        model_id,
        upstream_provider,
        display_name,
        input_per_1m,
        output_per_1m,
        currency,
        source,
        source_priority,
        source_url,
        source_updated_at,
        raw_source_payload,
        raw_provider_payload,
        match_status,
        match_confidence,
        match_method,
        match_evidence,
        updated_at,
        last_seen_at
      from pricing.model_price_records
      union all
      select
        null as id,
        service_provider,
        model_id,
        upstream_provider,
        display_name,
        input_per_1m,
        output_per_1m,
        currency,
        source,
        0 as source_priority,
        null as source_url,
        null as source_updated_at,
        null::jsonb as raw_source_payload,
        null::jsonb as raw_provider_payload,
        'legacy' as match_status,
        null::numeric as match_confidence,
        'legacy-model_prices' as match_method,
        null::jsonb as match_evidence,
        updated_at,
        updated_at as last_seen_at
      from pricing.model_prices
      where not exists (
        select 1
        from pricing.model_price_records r
        where r.service_provider = pricing.model_prices.service_provider
          and r.model_id = pricing.model_prices.model_id
      )
    ),
    ranked as (
      select
        *,
        row_number() over (
          partition by service_provider, model_id
          order by source_priority desc, updated_at desc
        ) as rank
      from records
    )
    select *
    from ranked
    order by service_provider, model_id, source_priority desc, updated_at desc
  `

  const groups = new Map<string, { key: string; provider: string; model: string; effective: PriceRecord | null; records: PriceRecord[] }>()
  for (const row of rows as any[]) {
    const record = rowToPriceRecord(row)
    const group = groups.get(record.key) ?? {
      key: record.key,
      provider: record.serviceProvider,
      model: record.modelId,
      effective: null,
      records: [],
    }
    if (Number(row.rank) === 1) group.effective = record
    group.records.push(record)
    groups.set(record.key, group)
  }

  return {
    records: Array.from(groups.values()),
    generatedAt: new Date().toISOString(),
  }
}

export async function upsertModelPrice(input: ModelPriceInput) {
  await ensurePricingSchema()
  const serviceProvider = normalizeServiceProvider(input.serviceProvider)
  const modelId = input.modelId.trim()
  if (!serviceProvider || !modelId) {
    throw new Error('serviceProvider and modelId are required')
  }
  if (!Number.isFinite(input.input) || !Number.isFinite(input.output) || input.input < 0 || input.output < 0) {
    throw new Error('input and output prices must be non-negative numbers')
  }

  const source = input.source ?? 'manual'
  const sourcePriority = input.sourcePriority ?? priorityForSource(source)
  const upstreamProvider = input.upstreamProvider ?? inferUpstreamProvider(serviceProvider, modelId)
  const displayName = input.displayName ?? modelId
  const matchEvidence = input.matchEvidence ?? buildMatchEvidence({
    serviceProvider,
    modelId,
    source,
    sourceProvider: upstreamProvider,
    sourceModelId: modelId,
    matchMethod: input.matchMethod ?? 'exact-id',
  })

  if (shouldUseLocalPersistence()) {
    return upsertLocalModelPrice({
      ...input,
      serviceProvider,
      modelId,
      upstreamProvider,
      displayName,
      source,
      sourcePriority,
      matchEvidence,
    })
  }

  const sql = getSql()
  await sql`
    insert into pricing.model_price_records (
      service_provider,
      model_id,
      upstream_provider,
      display_name,
      input_per_1m,
      output_per_1m,
      source,
      source_priority,
      source_url,
      source_updated_at,
      raw_source_payload,
      raw_provider_payload,
      match_status,
      match_confidence,
      match_method,
      match_evidence,
      updated_at,
      last_seen_at
    )
    values (
      ${serviceProvider},
      ${modelId},
      ${upstreamProvider},
      ${displayName},
      ${input.input},
      ${input.output},
      ${source},
      ${sourcePriority},
      ${input.sourceUrl ?? null},
      ${input.sourceUpdatedAt ?? null},
      ${jsonOrNull(input.rawSourcePayload)}::jsonb,
      ${jsonOrNull(input.rawProviderPayload)}::jsonb,
      ${input.matchStatus ?? 'matched'},
      ${input.matchConfidence ?? 1},
      ${input.matchMethod ?? 'exact-id'},
      ${JSON.stringify(matchEvidence)}::jsonb,
      now(),
      now()
    )
    on conflict (service_provider, model_id, source) do update set
      upstream_provider = excluded.upstream_provider,
      display_name = excluded.display_name,
      input_per_1m = excluded.input_per_1m,
      output_per_1m = excluded.output_per_1m,
      source_priority = excluded.source_priority,
      source_url = excluded.source_url,
      source_updated_at = excluded.source_updated_at,
      raw_source_payload = excluded.raw_source_payload,
      raw_provider_payload = excluded.raw_provider_payload,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      match_method = excluded.match_method,
      match_evidence = excluded.match_evidence,
      updated_at = now(),
      last_seen_at = now()
  `

  await sql`
    insert into pricing.model_prices (
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
      ${upstreamProvider},
      ${displayName},
      ${input.input},
      ${input.output},
      ${source},
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

export async function deleteModelPriceRecord(input: DeletePriceRecordInput) {
  if (shouldUseLocalPersistence()) return deleteLocalModelPriceRecord(input)
  await ensurePricingSchema()
  const sql = getSql()
  let deleted: { service_provider: string; model_id: string }[] = []

  if (Number.isFinite(input.id)) {
    deleted = await sql`
      delete from pricing.model_price_records
      where id = ${input.id}
      returning service_provider, model_id
    ` as any[]
  } else {
    const serviceProvider = normalizeServiceProvider(input.serviceProvider ?? '')
    const modelId = (input.modelId ?? '').trim()
    const source = (input.source ?? '').trim()
    if (!serviceProvider || !modelId) {
      throw new Error('id or serviceProvider/modelId is required')
    }

    if (source) {
      deleted = await sql`
        delete from pricing.model_price_records
        where service_provider = ${serviceProvider}
          and model_id = ${modelId}
          and source = ${source}
        returning service_provider, model_id
      ` as any[]
    }

    if (deleted.length === 0) {
      deleted = await sql`
        delete from pricing.model_prices
        where service_provider = ${serviceProvider}
          and model_id = ${modelId}
        returning service_provider, model_id
      ` as any[]
    }
  }

  for (const row of deleted) {
    await syncEffectiveModelPrice(row.service_provider, row.model_id)
  }

  return {
    deleted: deleted.length,
    keys: deleted.map(row => `${row.service_provider}/${row.model_id}`),
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

export function priorityForSource(source: string) {
  switch (source) {
    case 'provider-discovery':
      return 100
    case 'manual':
      return 50
    case 'llm-prices':
      return 10
    case 'imported-json':
    case 'seed_json':
      return 5
    default:
      return 0
  }
}

async function syncEffectiveModelPrice(serviceProvider: string, modelId: string) {
  const sql = getSql()
  const rows = await sql`
    select
      service_provider,
      model_id,
      upstream_provider,
      display_name,
      input_per_1m,
      output_per_1m,
      source
    from pricing.model_price_records
    where service_provider = ${serviceProvider}
      and model_id = ${modelId}
    order by source_priority desc, updated_at desc
    limit 1
  ` as any[]

  const next = rows[0]
  if (!next) {
    await sql`
      delete from pricing.model_prices
      where service_provider = ${serviceProvider}
        and model_id = ${modelId}
    `
    return
  }

  await sql`
    insert into pricing.model_prices (
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
      ${next.service_provider},
      ${next.model_id},
      ${next.upstream_provider},
      ${next.display_name},
      ${next.input_per_1m},
      ${next.output_per_1m},
      ${next.source},
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
}

export function buildMatchEvidence(input: {
  serviceProvider: string
  modelId: string
  source: string
  sourceProvider?: string | null
  sourceModelId?: string | null
  matchMethod?: string | null
}) {
  const normalizedProvider = normalizeServiceProvider(input.serviceProvider)
  const normalizedSourceProvider = normalizeServiceProvider(input.sourceProvider ?? input.serviceProvider)
  const normalizedModelId = normalizeModelId(input.modelId)
  const normalizedSourceModelId = normalizeModelId(input.sourceModelId ?? input.modelId)

  return {
    source: input.source,
    compared: {
      provider: input.serviceProvider,
      modelId: input.modelId,
      sourceProvider: input.sourceProvider ?? input.serviceProvider,
      sourceModelId: input.sourceModelId ?? input.modelId,
      normalizedProvider,
      normalizedSourceProvider,
      normalizedModelId,
      normalizedSourceModelId,
    },
    method: input.matchMethod ?? 'exact-id',
    providerMatched: normalizedProvider === normalizedSourceProvider,
    modelMatched: normalizedModelId === normalizedSourceModelId,
  }
}

function normalizeModelId(value: string) {
  return value.trim().toLowerCase().replace(/^models\//, '')
}

function jsonOrNull(value: unknown) {
  if (value == null) return null
  return JSON.stringify(value)
}

async function getLocalPricing() {
  const records = await readLocalJson<PriceRecord[]>('pricing-records.json', [])
  const byKey = new Map<string, PriceRecord>()
  for (const record of records) {
    const current = byKey.get(record.key)
    if (!current || record.sourcePriority > current.sourcePriority || record.updatedAt > current.updatedAt) {
      byKey.set(record.key, record)
    }
  }
  const pricing: FlatPricing = {}
  for (const record of byKey.values()) {
    pricing[record.key] = { input: record.input, output: record.output, per: '1M' }
  }
  return pricing
}

async function getLocalPricingRecords() {
  const records = await readLocalJson<PriceRecord[]>('pricing-records.json', [])
  const groups = new Map<string, { key: string; provider: string; model: string; effective: PriceRecord | null; records: PriceRecord[] }>()
  for (const record of records.sort((a, b) => a.serviceProvider.localeCompare(b.serviceProvider) || a.modelId.localeCompare(b.modelId) || b.sourcePriority - a.sourcePriority)) {
    const group = groups.get(record.key) ?? { key: record.key, provider: record.serviceProvider, model: record.modelId, effective: null, records: [] }
    group.records.push(record)
    if (!group.effective || record.sourcePriority > group.effective.sourcePriority || record.updatedAt > group.effective.updatedAt) {
      group.effective = record
    }
    groups.set(record.key, group)
  }
  return { records: Array.from(groups.values()), generatedAt: new Date().toISOString() }
}

async function upsertLocalModelPrice(input: ModelPriceInput & {
  serviceProvider: string
  modelId: string
  upstreamProvider: string | null
  displayName: string | null
  source: string
  sourcePriority: number
}) {
  const records = await readLocalJson<PriceRecord[]>('pricing-records.json', [])
  const now = new Date().toISOString()
  const key = `${input.serviceProvider}/${input.modelId}`
  const existingIndex = records.findIndex(record => record.serviceProvider === input.serviceProvider && record.modelId === input.modelId && record.source === input.source)
  const existing = existingIndex >= 0 ? records[existingIndex] : null
  const record: PriceRecord = {
    id: existing?.id ?? nextLocalId(records),
    key,
    serviceProvider: input.serviceProvider,
    modelId: input.modelId,
    upstreamProvider: input.upstreamProvider,
    displayName: input.displayName,
    input: input.input,
    output: input.output,
    currency: 'USD',
    source: input.source,
    sourcePriority: input.sourcePriority,
    sourceUrl: input.sourceUrl ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    rawSourcePayload: input.rawSourcePayload ?? null,
    rawProviderPayload: input.rawProviderPayload ?? null,
    matchStatus: input.matchStatus ?? 'matched',
    matchConfidence: input.matchConfidence ?? null,
    matchMethod: input.matchMethod ?? null,
    matchEvidence: input.matchEvidence ?? null,
    updatedAt: now,
    lastSeenAt: now,
  }
  if (existingIndex >= 0) records[existingIndex] = record
  else records.push(record)
  await writeLocalJson('pricing-records.json', records)
  return { key, price: { input: input.input, output: input.output, per: '1M' } }
}

async function deleteLocalModelPriceRecord(input: DeletePriceRecordInput) {
  const records = await readLocalJson<PriceRecord[]>('pricing-records.json', [])
  const serviceProvider = normalizeServiceProvider(input.serviceProvider ?? '')
  const modelId = (input.modelId ?? '').trim()
  const source = (input.source ?? '').trim()
  const next = records.filter(record => {
    if (Number.isFinite(input.id)) return record.id !== input.id
    if (!serviceProvider || !modelId) return true
    if (record.serviceProvider !== serviceProvider || record.modelId !== modelId) return true
    return source ? record.source !== source : false
  })
  await writeLocalJson('pricing-records.json', next)
  const deleted = records.length - next.length
  return {
    deleted,
    keys: records.filter(record => !next.includes(record)).map(record => record.key),
  }
}

function rowToPriceRecord(row: any): PriceRecord {
  return {
    id: row.id == null ? undefined : Number(row.id),
    key: `${row.service_provider}/${row.model_id}`,
    serviceProvider: row.service_provider,
    modelId: row.model_id,
    upstreamProvider: row.upstream_provider,
    displayName: row.display_name,
    input: Number(row.input_per_1m),
    output: Number(row.output_per_1m),
    currency: row.currency,
    source: row.source,
    sourcePriority: Number(row.source_priority),
    sourceUrl: row.source_url,
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at).toISOString() : null,
    rawSourcePayload: row.raw_source_payload,
    rawProviderPayload: row.raw_provider_payload,
    matchStatus: row.match_status,
    matchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
    matchMethod: row.match_method,
    matchEvidence: row.match_evidence,
    updatedAt: new Date(row.updated_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  }
}
