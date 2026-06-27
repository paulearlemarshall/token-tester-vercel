import { getSql } from './db'
import { nextLocalId, readLocalJson, shouldUseLocalPersistence, writeLocalJson } from './local-persistence'
import { normalizeServiceProvider } from './pricing'

export interface RunResultInput {
  runId: string
  recordKey?: string
  status: string
  providerId?: string
  providerName: string
  serviceProvider?: string
  model: string
  sourceType: string
  sourceLabel: string
  runName?: string | null
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
  pdfSent?: boolean
  pdfFileSize?: number | null
  imageSent?: boolean
  imageFileSize?: number | null
  videoSent?: boolean
  videoFileSize?: number | null
  audioSent?: boolean
  audioFileSize?: number | null
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
  documentCategory?: string | null
  documentCategoryConfidence?: number | null
  documentCategorySource?: string | null
  requestPayload?: unknown
  responsePayload?: unknown
  runStartedAt?: string | number | Date | null
  completedAt?: string | number | Date | null
}

let schemaReady = false

async function ensureRunResultsSchema() {
  if (schemaReady) return
  const sql = getSql()
  await sql`CREATE SCHEMA IF NOT EXISTS results`
  const tables = await sql`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = 'run_results' AND table_schema IN ('results', 'public')
  ` as any[]
  const hasPublic = tables.some((r: any) => r.table_schema === 'public')
  const hasResults = tables.some((r: any) => r.table_schema === 'results')
  if (hasPublic && !hasResults) {
    await sql`ALTER TABLE public.run_results SET SCHEMA results`
  } else if (!hasPublic && !hasResults) {
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
      run_started_at timestamptz,
      completed_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  }
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
  await sql`create index if not exists results.run_results_completed_idx on results.run_results (completed_at desc)`
  await sql`create index if not exists results.run_results_created_idx on results.run_results (created_at desc)`
  await sql`create index if not exists results.run_results_provider_model_idx on results.run_results (service_provider, model, completed_at desc)`
  await sql`create index if not exists results.run_results_status_idx on results.run_results (status, completed_at desc)`
  await sql`create index if not exists results.run_results_input_hash_idx on results.run_results (input_hash)`
  await sql`create index if not exists results.run_results_file_hash_idx on results.run_results (file_hash)`
  await sql`create index if not exists results.run_results_suppressed_idx on results.run_results (suppressed, completed_at desc)`
  await sql`create index if not exists results.run_results_record_key_idx on results.run_results (record_key, completed_at desc, created_at desc)`
  schemaReady = true
}

export async function saveRunResult(input: RunResultInput) {
  if (!input.runId || !input.providerName || !input.model || !input.inputHash) {
    throw new Error('runId, providerName, model, and inputHash are required')
  }
  if (shouldUseLocalPersistence()) return saveLocalRunResult(input)

  await ensureRunResultsSchema()
  const sql = getSql()
  const serviceProvider = normalizeServiceProvider(input.serviceProvider || input.providerName)
  const recordKey = input.recordKey || `${serviceProvider}|${input.model}|${input.inputHash}`
  const completedAt = input.completedAt ? new Date(input.completedAt).toISOString() : new Date().toISOString()
  const runStartedAt = input.runStartedAt ? new Date(input.runStartedAt).toISOString() : null

  await sql`
    insert into results.run_results (
      run_id,
      record_key,
      run_name,
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
      pdf_sent,
      pdf_file_size,
      image_sent,
      image_file_size,
      video_sent,
      video_file_size,
      audio_sent,
      audio_file_size,
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
      document_category,
      document_category_confidence,
      document_category_source,
      request_payload,
      response_payload,
      suppressed,
      run_started_at,
      completed_at,
      updated_at
    )
    values (
      ${input.runId},
      ${recordKey},
      ${input.runName ?? null},
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
      ${input.pdfSent ?? false},
      ${input.pdfFileSize ?? null},
      ${input.imageSent ?? false},
      ${input.imageFileSize ?? null},
      ${input.videoSent ?? false},
      ${input.videoFileSize ?? null},
      ${input.audioSent ?? false},
      ${input.audioFileSize ?? null},
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
      ${input.documentCategory ?? null},
      ${input.documentCategoryConfidence ?? null},
      ${input.documentCategorySource ?? null},
      ${jsonOrNull(input.requestPayload)}::jsonb,
      ${jsonOrNull(input.responsePayload)}::jsonb,
      false,
      ${runStartedAt},
      ${completedAt},
      now()
    )
    on conflict (run_id) do update set
      status = excluded.status,
      record_key = excluded.record_key,
      run_name = excluded.run_name,
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
      pdf_sent = excluded.pdf_sent,
      pdf_file_size = excluded.pdf_file_size,
      image_sent = excluded.image_sent,
      image_file_size = excluded.image_file_size,
      video_sent = excluded.video_sent,
      video_file_size = excluded.video_file_size,
      audio_sent = excluded.audio_sent,
      audio_file_size = excluded.audio_file_size,
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
      document_category = excluded.document_category,
      document_category_confidence = excluded.document_category_confidence,
      document_category_source = excluded.document_category_source,
      request_payload = excluded.request_payload,
      response_payload = excluded.response_payload,
      suppressed = excluded.suppressed,
      run_started_at = excluded.run_started_at,
      completed_at = excluded.completed_at,
      updated_at = now()
  `

  return { ok: true }
}

export async function getRunResults(limit = 1000) {
  if (shouldUseLocalPersistence()) return getLocalRunResults(limit)
  await ensureRunResultsSchema()
  const sql = getSql()
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1000, 1), 5000)
  const rows = await sql`
    select
      id,
      run_id,
      record_key,
      run_name,
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
      pdf_sent,
      pdf_file_size,
      image_sent,
      image_file_size,
      video_sent,
      video_file_size,
      audio_sent,
      audio_file_size,
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
      document_category,
      document_category_confidence,
      document_category_source,
      request_payload,
      response_payload,
      suppressed,
      run_started_at,
      completed_at,
      created_at,
      updated_at
    from results.run_results
    order by completed_at desc
    limit ${safeLimit}
  `

  return {
    records: (rows as any[]).map(rowToRunResult),
    generatedAt: new Date().toISOString(),
  }
}

export async function updateRunResultsSuppressed(ids: number[], suppressed: boolean) {
  if (shouldUseLocalPersistence()) return updateLocalRunResultsSuppressed(ids, suppressed)
  await ensureRunResultsSchema()
  const normalizedIds = normalizeIds(ids)
  if (normalizedIds.length === 0) return { updated: 0 }
  const sql = getSql()
  const rows = await sql`
    update results.run_results
    set suppressed = ${suppressed}, updated_at = now()
    where id = any(${normalizedIds}::bigint[])
    returning id
  `
  return { updated: (rows as any[]).length }
}

export async function deleteRunResults(ids: number[]) {
  if (shouldUseLocalPersistence()) return deleteLocalRunResults(ids)
  await ensureRunResultsSchema()
  const normalizedIds = normalizeIds(ids)
  if (normalizedIds.length === 0) return { deleted: 0 }
  const sql = getSql()
  const rows = await sql`
    delete from results.run_results
    where id = any(${normalizedIds}::bigint[])
    returning id
  `
  return { deleted: (rows as any[]).length }
}

function rowToRunResult(row: any) {
  return {
    id: Number(row.id),
    runId: row.run_id,
    recordKey: row.record_key,
    runName: row.run_name ?? null,
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
    pdfSent: Boolean(row.pdf_sent),
    pdfFileSize: row.pdf_file_size == null ? null : Number(row.pdf_file_size),
    imageSent: Boolean(row.image_sent),
    imageFileSize: row.image_file_size == null ? null : Number(row.image_file_size),
    videoSent: Boolean(row.video_sent),
    videoFileSize: row.video_file_size == null ? null : Number(row.video_file_size),
    audioSent: Boolean(row.audio_sent),
    audioFileSize: row.audio_file_size == null ? null : Number(row.audio_file_size),
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
    documentCategory: row.document_category,
    documentCategoryConfidence: row.document_category_confidence == null ? null : Number(row.document_category_confidence),
    documentCategorySource: row.document_category_source,
    requestPayload: row.request_payload,
    responsePayload: row.response_payload,
    suppressed: Boolean(row.suppressed),
    runStartedAt: row.run_started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function jsonOrNull(value: unknown) {
  return value == null ? null : JSON.stringify(value)
}

function normalizeIds(ids: number[]) {
  return [...new Set((ids ?? [])
    .map(id => Number(id))
    .filter(id => Number.isSafeInteger(id) && id > 0))]
}

async function saveLocalRunResult(input: RunResultInput) {
  const rows = await readLocalJson<any[]>('run-results.json', [])
  const serviceProvider = normalizeServiceProvider(input.serviceProvider || input.providerName)
  const completedAt = input.completedAt ? new Date(input.completedAt).toISOString() : new Date().toISOString()
  const now = new Date().toISOString()
  const existingIndex = rows.findIndex(row => row.runId === input.runId)
  const existing = existingIndex >= 0 ? rows[existingIndex] : null
  const row = {
    id: existing?.id ?? nextLocalId(rows),
    runId: input.runId,
    recordKey: input.recordKey || `${serviceProvider}|${input.model}|${input.inputHash}`,
    runName: input.runName ?? null,
    status: input.status,
    providerId: input.providerId ?? null,
    providerName: input.providerName,
    serviceProvider,
    model: input.model,
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel,
    systemPrompt: input.systemPrompt ?? '',
    systemPromptHash: input.systemPromptHash ?? null,
    userMessage: input.userMessage ?? '',
    userMessageHash: input.userMessageHash ?? null,
    inputHash: input.inputHash,
    fileName: input.fileName ?? null,
    filePath: input.filePath ?? null,
    fileSize: input.fileSize ?? null,
    fileType: input.fileType ?? null,
    fileMimeType: input.fileMimeType ?? null,
    fileHash: input.fileHash ?? null,
    fileMetadata: input.fileMetadata ?? null,
    batchFiles: input.batchFiles ?? null,
    pdfSent: input.pdfSent ?? false,
    pdfFileSize: input.pdfFileSize ?? null,
    imageSent: input.imageSent ?? false,
    imageFileSize: input.imageFileSize ?? null,
    videoSent: input.videoSent ?? false,
    videoFileSize: input.videoFileSize ?? null,
    audioSent: input.audioSent ?? false,
    audioFileSize: input.audioFileSize ?? null,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    localInputTokens: input.localInputTokens ?? null,
    latencyMs: input.latencyMs ?? 0,
    inputPricePer1m: input.inputPricePer1m ?? null,
    outputPricePer1m: input.outputPricePer1m ?? null,
    estimatedCost: input.estimatedCost ?? null,
    responseText: input.responseText ?? '',
    error: input.error ?? null,
    documentCategory: input.documentCategory ?? null,
    documentCategoryConfidence: input.documentCategoryConfidence ?? null,
    documentCategorySource: input.documentCategorySource ?? null,
    requestPayload: input.requestPayload ?? null,
    responsePayload: input.responsePayload ?? null,
    suppressed: existing?.suppressed ?? false,
    runStartedAt: input.runStartedAt ? new Date(input.runStartedAt).toISOString() : null,
    completedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (existingIndex >= 0) rows[existingIndex] = row
  else rows.push(row)
  await writeLocalJson('run-results.json', rows)
  return { ok: true }
}

async function getLocalRunResults(limit = 1000) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1000, 1), 5000)
  const rows = await readLocalJson<any[]>('run-results.json', [])
  return {
    records: rows.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, safeLimit),
    generatedAt: new Date().toISOString(),
  }
}

async function updateLocalRunResultsSuppressed(ids: number[], suppressed: boolean) {
  const normalizedIds = normalizeIds(ids)
  if (normalizedIds.length === 0) return { updated: 0 }
  const idSet = new Set(normalizedIds)
  const rows = await readLocalJson<any[]>('run-results.json', [])
  let updated = 0
  const next = rows.map(row => {
    if (!idSet.has(Number(row.id))) return row
    updated++
    return { ...row, suppressed, updatedAt: new Date().toISOString() }
  })
  await writeLocalJson('run-results.json', next)
  return { updated }
}

async function deleteLocalRunResults(ids: number[]) {
  const normalizedIds = normalizeIds(ids)
  if (normalizedIds.length === 0) return { deleted: 0 }
  const idSet = new Set(normalizedIds)
  const rows = await readLocalJson<any[]>('run-results.json', [])
  const next = rows.filter(row => !idSet.has(Number(row.id)))
  await writeLocalJson('run-results.json', next)
  return { deleted: rows.length - next.length }
}
