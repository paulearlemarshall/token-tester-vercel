import { getSql } from './db'
import { normalizeServiceProvider } from './pricing'

export interface RunResultInput {
  runId: string
  status: string
  providerId?: string
  providerName: string
  serviceProvider?: string
  model: string
  sourceType: string
  sourceLabel: string
  systemPrompt?: string
  systemPromptHash?: string
  userMessage?: string
  userMessageHash?: string
  inputHash: string
  fileName?: string | null
  filePath?: string | null
  fileSize?: number | null
  fileType?: string | null
  fileMimeType?: string | null
  fileHash?: string | null
  fileMetadata?: unknown
  batchFiles?: unknown
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  localInputTokens?: number | null
  latencyMs?: number
  inputPricePer1m?: number | null
  outputPricePer1m?: number | null
  estimatedCost?: number | null
  responseText?: string
  error?: string
  requestPayload?: unknown
  responsePayload?: unknown
  runStartedAt?: string | number | Date | null
  completedAt?: string | number | Date | null
}

let schemaReady = false

async function ensureRunResultsSchema() {
  if (schemaReady) return
  const sql = getSql()
  await sql`
    create table if not exists run_results (
      id bigserial primary key,
      run_id text not null unique,
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
      request_payload jsonb,
      response_payload jsonb,
      run_started_at timestamptz,
      completed_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  await sql`create index if not exists run_results_completed_idx on run_results (completed_at desc)`
  await sql`create index if not exists run_results_provider_model_idx on run_results (service_provider, model, completed_at desc)`
  await sql`create index if not exists run_results_status_idx on run_results (status, completed_at desc)`
  await sql`create index if not exists run_results_input_hash_idx on run_results (input_hash)`
  await sql`create index if not exists run_results_file_hash_idx on run_results (file_hash)`
  schemaReady = true
}

export async function saveRunResult(input: RunResultInput) {
  if (!input.runId || !input.providerName || !input.model || !input.inputHash) {
    throw new Error('runId, providerName, model, and inputHash are required')
  }

  await ensureRunResultsSchema()
  const sql = getSql()
  const serviceProvider = normalizeServiceProvider(input.serviceProvider || input.providerName)
  const completedAt = input.completedAt ? new Date(input.completedAt).toISOString() : new Date().toISOString()
  const runStartedAt = input.runStartedAt ? new Date(input.runStartedAt).toISOString() : null

  await sql`
    insert into run_results (
      run_id,
      status,
      provider_id,
      provider_name,
      service_provider,
      model,
      source_type,
      source_label,
      system_prompt,
      system_prompt_hash,
      user_message,
      user_message_hash,
      input_hash,
      file_name,
      file_path,
      file_size,
      file_type,
      file_mime_type,
      file_hash,
      file_metadata,
      batch_files,
      input_tokens,
      output_tokens,
      total_tokens,
      local_input_tokens,
      latency_ms,
      input_price_per_1m,
      output_price_per_1m,
      estimated_cost,
      response_text,
      error,
      request_payload,
      response_payload,
      run_started_at,
      completed_at,
      updated_at
    )
    values (
      ${input.runId},
      ${input.status},
      ${input.providerId ?? null},
      ${input.providerName},
      ${serviceProvider},
      ${input.model},
      ${input.sourceType},
      ${input.sourceLabel},
      ${input.systemPrompt ?? ''},
      ${input.systemPromptHash ?? null},
      ${input.userMessage ?? ''},
      ${input.userMessageHash ?? null},
      ${input.inputHash},
      ${input.fileName ?? null},
      ${input.filePath ?? null},
      ${input.fileSize ?? null},
      ${input.fileType ?? null},
      ${input.fileMimeType ?? null},
      ${input.fileHash ?? null},
      ${jsonOrNull(input.fileMetadata)}::jsonb,
      ${jsonOrNull(input.batchFiles)}::jsonb,
      ${input.inputTokens ?? 0},
      ${input.outputTokens ?? 0},
      ${input.totalTokens ?? 0},
      ${input.localInputTokens ?? null},
      ${input.latencyMs ?? 0},
      ${input.inputPricePer1m ?? null},
      ${input.outputPricePer1m ?? null},
      ${input.estimatedCost ?? null},
      ${input.responseText ?? ''},
      ${input.error ?? null},
      ${jsonOrNull(input.requestPayload)}::jsonb,
      ${jsonOrNull(input.responsePayload)}::jsonb,
      ${runStartedAt},
      ${completedAt},
      now()
    )
    on conflict (run_id) do update set
      status = excluded.status,
      provider_id = excluded.provider_id,
      provider_name = excluded.provider_name,
      service_provider = excluded.service_provider,
      model = excluded.model,
      source_type = excluded.source_type,
      source_label = excluded.source_label,
      system_prompt = excluded.system_prompt,
      system_prompt_hash = excluded.system_prompt_hash,
      user_message = excluded.user_message,
      user_message_hash = excluded.user_message_hash,
      input_hash = excluded.input_hash,
      file_name = excluded.file_name,
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      file_type = excluded.file_type,
      file_mime_type = excluded.file_mime_type,
      file_hash = excluded.file_hash,
      file_metadata = excluded.file_metadata,
      batch_files = excluded.batch_files,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      local_input_tokens = excluded.local_input_tokens,
      latency_ms = excluded.latency_ms,
      input_price_per_1m = excluded.input_price_per_1m,
      output_price_per_1m = excluded.output_price_per_1m,
      estimated_cost = excluded.estimated_cost,
      response_text = excluded.response_text,
      error = excluded.error,
      request_payload = excluded.request_payload,
      response_payload = excluded.response_payload,
      run_started_at = excluded.run_started_at,
      completed_at = excluded.completed_at,
      updated_at = now()
  `

  return { ok: true }
}

export async function getRunResults(limit = 1000) {
  await ensureRunResultsSchema()
  const sql = getSql()
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1000, 1), 5000)
  const rows = await sql`
    select
      id,
      run_id,
      status,
      provider_id,
      provider_name,
      service_provider,
      model,
      source_type,
      source_label,
      system_prompt,
      system_prompt_hash,
      user_message,
      user_message_hash,
      input_hash,
      file_name,
      file_path,
      file_size,
      file_type,
      file_mime_type,
      file_hash,
      file_metadata,
      batch_files,
      input_tokens,
      output_tokens,
      total_tokens,
      local_input_tokens,
      latency_ms,
      input_price_per_1m,
      output_price_per_1m,
      estimated_cost,
      response_text,
      error,
      request_payload,
      response_payload,
      run_started_at,
      completed_at,
      created_at,
      updated_at
    from run_results
    order by completed_at desc
    limit ${safeLimit}
  `

  return {
    records: (rows as any[]).map(rowToRunResult),
    generatedAt: new Date().toISOString(),
  }
}

function rowToRunResult(row: any) {
  return {
    id: Number(row.id),
    runId: row.run_id,
    status: row.status,
    providerId: row.provider_id,
    providerName: row.provider_name,
    serviceProvider: row.service_provider,
    model: row.model,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    systemPrompt: row.system_prompt,
    systemPromptHash: row.system_prompt_hash,
    userMessage: row.user_message,
    userMessageHash: row.user_message_hash,
    inputHash: row.input_hash,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    fileType: row.file_type,
    fileMimeType: row.file_mime_type,
    fileHash: row.file_hash,
    fileMetadata: row.file_metadata,
    batchFiles: row.batch_files,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    localInputTokens: row.local_input_tokens == null ? null : Number(row.local_input_tokens),
    latencyMs: Number(row.latency_ms ?? 0),
    inputPricePer1m: row.input_price_per_1m == null ? null : Number(row.input_price_per_1m),
    outputPricePer1m: row.output_price_per_1m == null ? null : Number(row.output_price_per_1m),
    estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
    responseText: row.response_text,
    error: row.error,
    requestPayload: row.request_payload,
    responsePayload: row.response_payload,
    runStartedAt: row.run_started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function jsonOrNull(value: unknown) {
  return value == null ? null : JSON.stringify(value)
}
