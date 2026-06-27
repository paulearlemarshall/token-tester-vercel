import { getSql } from './db'
import type { ModelPreset, ModelPresetModel } from '../types'

export interface ModelPresetInput {
  name: string
  models: ModelPresetModel[]
}

let schemaReady = false

async function ensureModelPresetSchema() {
  if (schemaReady) return
  const sql = getSql() as any
  await sql`CREATE SCHEMA IF NOT EXISTS config`
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_class WHERE relname = 'model_presets' AND relnamespace = 'public'::regnamespace)
         AND NOT EXISTS (SELECT FROM pg_class WHERE relname = 'model_presets' AND relnamespace = 'config'::regnamespace) THEN
        ALTER TABLE public.model_presets SET SCHEMA config;
      END IF;
    END $$;
  `
  await sql`
    create table if not exists config.model_presets (
      id bigserial primary key,
      name text not null,
      models jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  await sql`create unique index if not exists config.model_presets_name_lower_idx on config.model_presets (lower(name))`
  schemaReady = true
}

function normalizeModels(models: unknown): ModelPresetModel[] {
  if (!Array.isArray(models)) return []
  return models
    .map((item: any) => ({
      providerName: String(item?.providerName ?? '').trim(),
      providerId: item?.providerId ? String(item.providerId) : undefined,
      adapterId: item?.adapterId,
      model: String(item?.model ?? '').trim(),
    }))
    .filter(item => item.providerName && item.model)
}

function rowToPreset(row: any): ModelPreset {
  return {
    id: Number(row.id),
    name: row.name,
    models: normalizeModels(row.models),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listModelPresets(): Promise<ModelPreset[]> {
  await ensureModelPresetSchema()
  const sql = getSql() as any
  const rows = await sql`
    select id, name, models, created_at, updated_at
    from config.model_presets
    order by lower(name) asc
  `
  return rows.map(rowToPreset)
}

export async function upsertModelPreset(input: ModelPresetInput): Promise<ModelPreset> {
  await ensureModelPresetSchema()
  const name = input.name.trim()
  if (!name) throw new Error('Preset name is required')
  const models = normalizeModels(input.models)
  const sql = getSql() as any
  const existing = await sql`
    select id
    from config.model_presets
    where lower(name) = lower(${name})
    limit 1
  `
  const rows = existing[0]?.id
    ? await sql`
        update config.model_presets
        set name = ${name},
            models = ${JSON.stringify(models)}::jsonb,
            updated_at = now()
        where id = ${existing[0].id}
        returning id, name, models, created_at, updated_at
      `
    : await sql`
        insert into config.model_presets (name, models)
        values (${name}, ${JSON.stringify(models)}::jsonb)
        returning id, name, models, created_at, updated_at
      `
  return rowToPreset(rows[0])
}

export async function deleteModelPreset(id: number): Promise<boolean> {
  await ensureModelPresetSchema()
  const sql = getSql() as any
  const rows = await sql`
    delete from config.model_presets
    where id = ${id}
    returning id
  `
  return rows.length > 0
}
