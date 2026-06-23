import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

loadEnv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured. Run `vercel env pull` first.')
}

const sql = neon(process.env.DATABASE_URL)

await sql`
  create table if not exists model_prices (
    service_provider text not null,
    model_id text not null,
    upstream_provider text,
    display_name text,
    input_per_1m numeric(12, 6) not null,
    output_per_1m numeric(12, 6) not null,
    currency text not null default 'USD',
    source text not null default 'manual',
    effective_from timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (service_provider, model_id)
  )
`

await sql`create index if not exists model_prices_upstream_idx on model_prices (upstream_provider)`
await sql`create index if not exists model_prices_updated_at_idx on model_prices (updated_at desc)`

await sql`
  create table if not exists model_price_records (
    id bigserial primary key,
    service_provider text not null,
    model_id text not null,
    upstream_provider text,
    display_name text,
    input_per_1m numeric(12, 6) not null,
    output_per_1m numeric(12, 6) not null,
    currency text not null default 'USD',
    source text not null,
    source_priority integer not null default 0,
    source_url text,
    source_updated_at timestamptz,
    raw_source_payload jsonb,
    raw_provider_payload jsonb,
    match_status text not null default 'unverified',
    match_confidence numeric(5, 4),
    match_method text,
    match_evidence jsonb,
    effective_from timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    unique (service_provider, model_id, source)
  )
`

await sql`create index if not exists model_price_records_effective_idx on model_price_records (service_provider, model_id, source_priority desc, updated_at desc)`
await sql`create index if not exists model_price_records_source_idx on model_price_records (source, updated_at desc)`
await sql`create index if not exists model_price_records_match_idx on model_price_records (match_status, match_confidence desc)`

console.log('model_prices schema is ready')

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
