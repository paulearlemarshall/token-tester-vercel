import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

loadEnv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured. Run `vercel env pull` first.')
}

const sql = neon(process.env.DATABASE_URL)
const rows = loadPriceRows()
let count = 0
let skipped = 0

for (const row of rows) {
  const serviceProvider = normalizeServiceProvider(row.provider)
  const modelId = String(row.model || '').trim()
  const input = Number(row.input)
  const output = Number(row.output)
  if (!serviceProvider || !modelId || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    skipped += 1
    continue
  }
  const upstreamProvider = inferUpstreamProvider(serviceProvider, modelId)
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
      ${modelId},
      ${input},
      ${output},
      'seed_json',
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

console.log(`seeded ${count} model price rows, skipped ${skipped} non-price rows`)

function loadPriceRows() {
  const flatJsonPath = path.resolve('..', 'model-prices-db.json')
  if (fs.existsSync(flatJsonPath)) {
    const rows = JSON.parse(fs.readFileSync(flatJsonPath, 'utf8'))
    if (Array.isArray(rows)) return rows
  }

  const ndjsonPath = path.resolve('..', 'model-prices-db.ndjson')
  if (fs.existsSync(ndjsonPath)) {
    return fs.readFileSync(ndjsonPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
  }

  const nestedPath = path.resolve('src/data/models.json')
  const nested = JSON.parse(fs.readFileSync(nestedPath, 'utf8'))
  const rows = []
  for (const [provider, providerModels] of Object.entries(nested)) {
    for (const [model, pricing] of Object.entries(providerModels)) {
      rows.push({ provider, model, input: pricing.input, output: pricing.output, per: pricing.per ?? '1M' })
    }
  }
  return rows
}

function normalizeServiceProvider(value) {
  return value.trim().toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function inferUpstreamProvider(serviceProvider, modelId) {
  if (serviceProvider === 'openrouter' && modelId.includes('/')) {
    return modelId.split('/')[0]
  }
  return serviceProvider
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
