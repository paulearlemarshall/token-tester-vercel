import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const LLM_PRICES_URL = 'https://www.llm-prices.com/current-v1.json'

loadEnv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured. Run `vercel env pull` first.')
}

const sql = neon(process.env.DATABASE_URL)
const { rows, sourceUrl, sourceUpdatedAt, sourceName } = await loadPriceRows()
let count = 0
let skipped = 0

for (const row of rows) {
  const serviceProvider = normalizeServiceProvider(row.provider ?? row.vendor ?? row.serviceProvider ?? row.service_provider)
  const modelId = String(row.model ?? row.id ?? row.modelId ?? row.model_id ?? '').trim()
  const input = Number(row.input ?? row.input_per_1m)
  const output = Number(row.output ?? row.output_per_1m)
  if (!serviceProvider || !modelId || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    skipped += 1
    continue
  }

  const upstreamProvider = inferUpstreamProvider(serviceProvider, modelId)
  const displayName = String(row.name ?? row.displayName ?? row.display_name ?? modelId)
  const source = sourceName || row.source || 'seed_json'
  const sourcePriority = source === 'llm-prices' ? 10 : 5
  const matchEvidence = {
    source,
    compared: {
      provider: serviceProvider,
      modelId,
      sourceProvider: row.vendor ?? row.provider ?? serviceProvider,
      sourceModelId: row.id ?? row.model ?? modelId,
      normalizedProvider: serviceProvider,
      normalizedSourceProvider: normalizeServiceProvider(row.vendor ?? row.provider ?? serviceProvider),
      normalizedModelId: normalizeModelId(modelId),
      normalizedSourceModelId: normalizeModelId(row.id ?? row.model ?? modelId),
    },
    method: source === 'llm-prices' ? 'llm-prices-vendor-id' : 'seed-row',
    providerMatched: true,
    modelMatched: true,
  }

  await sql`
    insert into model_price_records (
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
      ${input},
      ${output},
      ${source},
      ${sourcePriority},
      ${sourceUrl},
      ${sourceUpdatedAt},
      ${JSON.stringify(row)}::jsonb,
      'seeded',
      1,
      ${source === 'llm-prices' ? 'llm-prices-vendor-id' : 'seed-row'},
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
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      match_method = excluded.match_method,
      match_evidence = excluded.match_evidence,
      updated_at = now(),
      last_seen_at = now()
  `

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
      ${upstreamProvider},
      ${displayName},
      ${input},
      ${output},
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
  count += 1
}

console.log(`seeded ${count} model price rows from ${sourceName || 'json'}, skipped ${skipped} non-price rows`)

async function loadPriceRows() {
  const importPath = process.argv[2]
  if (!importPath) {
    throw new Error('Usage: npm run db:import-pricing -- <path-to-json-or-ndjson|llm-prices|llm-prices-url>')
  }

  if (importPath === 'llm-prices' || importPath === 'llm-prices-url') {
    const res = await fetch(LLM_PRICES_URL)
    if (!res.ok) throw new Error(`Failed to fetch llm-prices: ${res.status} ${res.statusText}`)
    return parseRows(await res.text(), LLM_PRICES_URL)
  }

  const fullPath = path.resolve(importPath)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Pricing import file not found: ${fullPath}`)
  }

  return parseRows(fs.readFileSync(fullPath, 'utf8'), fullPath)
}

function parseRows(text, sourceRef) {
  if (sourceRef.endsWith('.ndjson')) {
    return {
      rows: text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)),
      sourceUrl: sourceRef.startsWith('http') ? sourceRef : null,
      sourceUpdatedAt: null,
      sourceName: 'seed_json',
    }
  }

  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) {
    return { rows: parsed, sourceUrl: sourceRef.startsWith('http') ? sourceRef : null, sourceUpdatedAt: null, sourceName: 'seed_json' }
  }

  if (Array.isArray(parsed.prices)) {
    return {
      rows: parsed.prices,
      sourceUrl: sourceRef.startsWith('http') ? sourceRef : null,
      sourceUpdatedAt: parsed.updated_at ? `${parsed.updated_at}T00:00:00.000Z` : null,
      sourceName: 'llm-prices',
    }
  }

  const rows = []
  for (const [provider, providerModels] of Object.entries(parsed)) {
    for (const [model, pricing] of Object.entries(providerModels)) {
      rows.push({ provider, model, input: pricing.input, output: pricing.output, per: pricing.per ?? '1M', name: pricing.name })
    }
  }
  return { rows, sourceUrl: sourceRef.startsWith('http') ? sourceRef : null, sourceUpdatedAt: null, sourceName: 'seed_json' }
}

function normalizeServiceProvider(value) {
  return String(value || '').trim().toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function inferUpstreamProvider(serviceProvider, modelId) {
  if (serviceProvider === 'openrouter' && modelId.includes('/')) {
    return modelId.split('/')[0]
  }
  return serviceProvider
}

function normalizeModelId(value) {
  return String(value || '').trim().toLowerCase().replace(/^models\//, '')
}

function loadEnv() {
  const candidates = ['.env.local', '.env.development.local']
  for (const file of candidates) {
    const fullPath = path.resolve(file)
    if (!fs.existsSync(fullPath)) continue
    for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const [, key, raw] = match
      if (process.env[key]) continue
      let value = raw
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
