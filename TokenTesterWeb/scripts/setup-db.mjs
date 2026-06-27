import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

loadEnv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured. Run `vercel env pull` first.')
}

const sql = neon(process.env.DATABASE_URL)

// ── Schemas ──────────────────────────────────────────────────────────

await sql`create schema if not exists results`
await sql`create schema if not exists pricing`
await sql`create schema if not exists config`

// ── results.run_results ──────────────────────────────────────────────

await sql`
  create table if not exists results.run_results (
    id bigserial primary key,
    run_id text not null unique,
    record_key text,
    status text not null,
    provider_id text,
    provider_name text not null,
    service_provider text not null,
    model text not null,
    source_type text not null,
    source_label text not null,
    system_prompt text,
    system_prompt_hash text,
    user_message text,
    user_message_hash text,
    input_hash text not null,
    file_name text,
    file_path text,
    file_size bigint,
    file_type text,
    file_mime_type text,
    file_hash text,
    file_metadata jsonb,
    batch_files jsonb,
    pdf_sent boolean not null default false,
    pdf_file_size bigint,
    image_sent boolean not null default false,
    image_file_size bigint,
    video_sent boolean not null default false,
    video_file_size bigint,
    audio_sent boolean not null default false,
    audio_file_size bigint,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    total_tokens integer not null default 0,
    local_input_tokens integer,
    latency_ms integer not null default 0,
    input_price_per_1m numeric(12, 6),
    output_price_per_1m numeric(12, 6),
    estimated_cost numeric(18, 9),
    response_text text,
    error text,
    document_category text,
    document_category_confidence numeric(5, 4),
    document_category_source text,
    request_payload jsonb,
    response_payload jsonb,
    suppressed boolean not null default false,
    run_name text,
    run_started_at timestamptz,
    completed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`
await sql`alter table results.run_results add column if not exists suppressed boolean not null default false`
await sql`alter table results.run_results add column if not exists record_key text`
await sql`alter table results.run_results add column if not exists pdf_sent boolean not null default false`
await sql`alter table results.run_results add column if not exists pdf_file_size bigint`
await sql`alter table results.run_results add column if not exists image_sent boolean not null default false`
await sql`alter table results.run_results add column if not exists image_file_size bigint`
await sql`alter table results.run_results add column if not exists video_sent boolean not null default false`
await sql`alter table results.run_results add column if not exists video_file_size bigint`
await sql`alter table results.run_results add column if not exists audio_sent boolean not null default false`
await sql`alter table results.run_results add column if not exists audio_file_size bigint`
await sql`alter table results.run_results add column if not exists run_name text`
await sql`alter table results.run_results add column if not exists document_category text`
await sql`alter table results.run_results add column if not exists document_category_confidence numeric(5, 4)`
await sql`alter table results.run_results add column if not exists document_category_source text`
await sql`
  update results.run_results
  set record_key = concat_ws('|', service_provider, model, input_hash)
  where record_key is null
`
await sql`alter table results.run_results alter column record_key set not null`
await sql`create index if not exists run_results_completed_idx on results.run_results (completed_at desc)`
await sql`create index if not exists run_results_created_idx on results.run_results (created_at desc)`
await sql`create index if not exists run_results_provider_model_idx on results.run_results (service_provider, model, completed_at desc)`
await sql`create index if not exists run_results_status_idx on results.run_results (status, completed_at desc)`
await sql`create index if not exists run_results_input_hash_idx on results.run_results (input_hash)`
await sql`create index if not exists run_results_file_hash_idx on results.run_results (file_hash)`
await sql`create index if not exists run_results_suppressed_idx on results.run_results (suppressed, completed_at desc)`
await sql`create index if not exists run_results_record_key_idx on results.run_results (record_key, completed_at desc, created_at desc)`

// ── pricing.model_prices ─────────────────────────────────────────────

await sql`
  create table if not exists pricing.model_prices (
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
await sql`create index if not exists model_prices_upstream_idx on pricing.model_prices (upstream_provider)`
await sql`create index if not exists model_prices_updated_at_idx on pricing.model_prices (updated_at desc)`

// ── pricing.model_price_records ───────────────────────────────────────

await sql`
  create table if not exists pricing.model_price_records (
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
await sql`create index if not exists model_price_records_effective_idx on pricing.model_price_records (service_provider, model_id, source_priority desc, updated_at desc)`
await sql`create index if not exists model_price_records_source_idx on pricing.model_price_records (source, updated_at desc)`
await sql`create index if not exists model_price_records_match_idx on pricing.model_price_records (match_status, match_confidence desc)`

// ── config.file_prompts ──────────────────────────────────────────────

await sql`
  create table if not exists config.file_prompts (
    id serial primary key,
    text text not null,
    is_default_document boolean not null default false,
    is_default_image boolean not null default false,
    is_default_audio boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`

// ── config.model_presets ─────────────────────────────────────────────

await sql`
  create table if not exists config.model_presets (
    id bigserial primary key,
    name text not null,
    models jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`
await sql`create unique index if not exists model_presets_name_lower_idx on config.model_presets (lower(name))`

console.log('All schemas and tables are ready')
console.log('  results.run_results')
console.log('  pricing.model_prices')
console.log('  pricing.model_price_records')
console.log('  config.file_prompts')
console.log('  config.model_presets')

// ── Helpers ─────────────────────────────────────────────────────────

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
