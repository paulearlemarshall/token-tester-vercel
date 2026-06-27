import { getSql } from './db'
import { nextLocalId, readLocalJson, shouldUseLocalPersistence, writeLocalJson } from './local-persistence'

export interface FilePrompt {
  id: number
  text: string
  is_default_document: boolean
  is_default_image: boolean
  is_default_audio: boolean
  created_at: string
  updated_at: string
}

export interface FilePromptInput {
  text: string
  is_default_document?: boolean
  is_default_image?: boolean
  is_default_audio?: boolean
}

export interface FilePromptDefaults {
  document: { id: number; text: string } | null
  image: { id: number; text: string } | null
  audio: { id: number; text: string } | null
}

const DEFAULTS: FilePromptInput[] = [
  { text: 'Extract the text from this document in order, reply with only the text', is_default_document: true },
  { text: 'Perform speech to text on this file', is_default_audio: true },
  { text: 'Extract the text from this image, reply with only the text', is_default_image: true },
]

let schemaReady = false

async function ensureSchema() {
  if (schemaReady) return
  const sql = getSql() as any
  await sql`CREATE SCHEMA IF NOT EXISTS config`
  const tables = await sql`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = 'file_prompts' AND table_schema IN ('config', 'public')
  ` as any[]
  const hasPublic = tables.some((r: any) => r.table_schema === 'public')
  const hasConfig = tables.some((r: any) => r.table_schema === 'config')
  if (hasPublic && !hasConfig) {
    await sql`ALTER TABLE public.file_prompts SET SCHEMA config`
  } else if (!hasPublic && !hasConfig) {
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
  }
  await sql`alter table config.file_prompts drop column if exists file_type`.catch(() => {})
  await sql`alter table config.file_prompts add column if not exists is_default_document boolean not null default false`.catch(() => {})
  await sql`alter table config.file_prompts add column if not exists is_default_image boolean not null default false`.catch(() => {})
  await sql`alter table config.file_prompts add column if not exists is_default_audio boolean not null default false`.catch(() => {})
  schemaReady = true
}

async function seedDefaultsIfEmpty() {
  const sql = getSql() as any
  const rows = await sql`select count(*) as cnt from config.file_prompts`
  const count = Number(rows[0]?.cnt ?? 0)
  if (count > 0) return
  for (const d of DEFAULTS) {
    await sql`
      insert into config.file_prompts (text, is_default_document, is_default_image, is_default_audio)
      values (${d.text}, ${d.is_default_document ?? false}, ${d.is_default_image ?? false}, ${d.is_default_audio ?? false})
    `
  }
}

async function ensureAudioDefault() {
  const sql = getSql() as any
  const defaultAudioPrompt = defaultPromptForFileType('audio')
  const rows = await sql`
    select id, text
    from config.file_prompts
    where is_default_audio = true
    order by updated_at desc
    limit 1
  `
  const current = rows[0]
  if (current?.text === 'Perform speech to text on this audio file, reply with only the text') {
    await sql`
      update config.file_prompts
      set text = ${defaultAudioPrompt},
          updated_at = now()
      where id = ${current.id}
    `
    return
  }
  if (current?.text && !String(current.text).toLowerCase().includes('document')) return

  await sql`update config.file_prompts set is_default_audio = false where is_default_audio = true`
  const matching = await sql`
    select id
    from config.file_prompts
    where text = ${defaultAudioPrompt}
    limit 1
  `
  if (matching[0]?.id) {
    await sql`
      update config.file_prompts
      set is_default_audio = true,
          updated_at = now()
      where id = ${matching[0].id}
    `
    return
  }
  await sql`
    insert into config.file_prompts (text, is_default_audio)
    values (${defaultAudioPrompt}, true)
  `
}

async function ensureDefaultUniqueness(sql: any, type: string, excludeId?: number) {
  if (excludeId) {
    await sql.query(`update config.file_prompts set ${type} = false where ${type} = true and id != $1`, [excludeId])
  } else {
    await sql.query(`update config.file_prompts set ${type} = false where ${type} = true`)
  }
}

export async function listFilePrompts(): Promise<FilePrompt[]> {
  if (shouldUseLocalPersistence()) return listLocalFilePrompts()
  await ensureSchema()
  await seedDefaultsIfEmpty()
  await ensureAudioDefault()
  const sql = getSql() as any
  const rows = await sql`
    select id, text, is_default_document, is_default_image, is_default_audio, created_at, updated_at
    from config.file_prompts
    order by id asc
  `
  return rows as FilePrompt[]
}

export async function getDefaults(): Promise<FilePromptDefaults> {
  if (shouldUseLocalPersistence()) return getLocalDefaults()
  await ensureSchema()
  await seedDefaultsIfEmpty()
  await ensureAudioDefault()
  const sql = getSql() as any
  const rows: any[] = await sql`
    select id, text, is_default_document, is_default_image, is_default_audio
    from config.file_prompts
    where is_default_document = true or is_default_image = true or is_default_audio = true
  `
  return {
    document: rows.find((r: any) => r.is_default_document) ?? null,
    image: rows.find((r: any) => r.is_default_image) ?? null,
    audio: rows.find((r: any) => r.is_default_audio) ?? null,
  }
}

export async function createFilePrompt(input: FilePromptInput): Promise<FilePrompt> {
  if (shouldUseLocalPersistence()) return createLocalFilePrompt(input)
  await ensureSchema()
  const sql = getSql() as any

  for (const flag of ['is_default_document', 'is_default_image', 'is_default_audio'] as const) {
    if (input[flag]) await ensureDefaultUniqueness(sql, flag)
  }

  const rows = await sql`
    insert into config.file_prompts (text, is_default_document, is_default_image, is_default_audio)
    values (${input.text}, ${input.is_default_document ?? false}, ${input.is_default_image ?? false}, ${input.is_default_audio ?? false})
    returning id, text, is_default_document, is_default_image, is_default_audio, created_at, updated_at
  `
  return rows[0] as FilePrompt
}

export async function updateFilePrompt(id: number, input: FilePromptInput): Promise<FilePrompt | null> {
  if (shouldUseLocalPersistence()) return updateLocalFilePrompt(id, input)
  const sql = getSql() as any

  for (const flag of ['is_default_document', 'is_default_image', 'is_default_audio'] as const) {
    if (input[flag]) await ensureDefaultUniqueness(sql, flag, id)
  }

  const rows = await sql`
    update config.file_prompts
    set text = ${input.text},
        is_default_document = ${input.is_default_document ?? false},
        is_default_image = ${input.is_default_image ?? false},
        is_default_audio = ${input.is_default_audio ?? false},
        updated_at = now()
    where id = ${id}
    returning id, text, is_default_document, is_default_image, is_default_audio, created_at, updated_at
  `
  return (rows[0] ?? null) as FilePrompt | null
}

export async function deleteFilePrompt(id: number): Promise<boolean> {
  if (shouldUseLocalPersistence()) return deleteLocalFilePrompt(id)
  const sql = getSql() as any
  const rows = await sql`
    delete from config.file_prompts where id = ${id}
    returning id
  `
  return rows.length > 0
}

async function listLocalFilePrompts(): Promise<FilePrompt[]> {
  const rows = await readLocalJson<FilePrompt[]>('file-prompts.json', [])
  if (rows.length > 0) return ensureLocalAudioDefault(rows)
  const now = new Date().toISOString()
  const seeded = DEFAULTS.map((item, index) => ({
    id: index + 1,
    text: item.text,
    is_default_document: item.is_default_document ?? false,
    is_default_image: item.is_default_image ?? false,
    is_default_audio: item.is_default_audio ?? false,
    created_at: now,
    updated_at: now,
  }))
  await writeLocalJson('file-prompts.json', seeded)
  return seeded
}

async function getLocalDefaults(): Promise<FilePromptDefaults> {
  const rows = await listLocalFilePrompts()
  return {
    document: rows.find(row => row.is_default_document) ?? null,
    image: rows.find(row => row.is_default_image) ?? null,
    audio: rows.find(row => row.is_default_audio) ?? null,
  }
}

async function createLocalFilePrompt(input: FilePromptInput): Promise<FilePrompt> {
  const rows = await listLocalFilePrompts()
  const now = new Date().toISOString()
  const nextRows = clearLocalDefaults(rows, input)
  const row: FilePrompt = {
    id: nextLocalId(nextRows),
    text: input.text,
    is_default_document: input.is_default_document ?? false,
    is_default_image: input.is_default_image ?? false,
    is_default_audio: input.is_default_audio ?? false,
    created_at: now,
    updated_at: now,
  }
  nextRows.push(row)
  await writeLocalJson('file-prompts.json', nextRows)
  return row
}

async function updateLocalFilePrompt(id: number, input: FilePromptInput): Promise<FilePrompt | null> {
  const rows = await listLocalFilePrompts()
  const index = rows.findIndex(row => row.id === id)
  if (index < 0) return null
  const nextRows = clearLocalDefaults(rows, input, id)
  const row: FilePrompt = {
    ...nextRows[index],
    text: input.text,
    is_default_document: input.is_default_document ?? false,
    is_default_image: input.is_default_image ?? false,
    is_default_audio: input.is_default_audio ?? false,
    updated_at: new Date().toISOString(),
  }
  nextRows[index] = row
  await writeLocalJson('file-prompts.json', nextRows)
  return row
}

async function deleteLocalFilePrompt(id: number): Promise<boolean> {
  const rows = await listLocalFilePrompts()
  const next = rows.filter(row => row.id !== id)
  await writeLocalJson('file-prompts.json', next)
  return next.length !== rows.length
}

function clearLocalDefaults(rows: FilePrompt[], input: FilePromptInput, excludeId?: number) {
  return rows.map(row => ({
    ...row,
    is_default_document: input.is_default_document && row.id !== excludeId ? false : row.is_default_document,
    is_default_image: input.is_default_image && row.id !== excludeId ? false : row.is_default_image,
    is_default_audio: input.is_default_audio && row.id !== excludeId ? false : row.is_default_audio,
  }))
}

async function ensureLocalAudioDefault(rows: FilePrompt[]) {
  const defaultAudioPrompt = defaultPromptForFileType('audio')!
  const current = rows.find(row => row.is_default_audio)
  if (current?.text && !current.text.toLowerCase().includes('document') && current.text !== 'Perform speech to text on this audio file, reply with only the text') return rows
  const now = new Date().toISOString()
  const updated = rows.map(row => ({
    ...row,
    is_default_audio: row.text === defaultAudioPrompt,
    text: row.id === current?.id ? defaultAudioPrompt : row.text,
    updated_at: row.id === current?.id ? now : row.updated_at,
  }))
  if (!updated.some(row => row.is_default_audio)) {
    updated.push({
      id: nextLocalId(updated),
      text: defaultAudioPrompt,
      is_default_document: false,
      is_default_image: false,
      is_default_audio: true,
      created_at: now,
      updated_at: now,
    })
  }
  await writeLocalJson('file-prompts.json', updated)
  return updated
}

export function defaultPromptForFileType(fileType: string): string | null {
  switch (fileType) {
    case 'document':
      return 'Extract the text from this document in order, reply with only the text'
    case 'audio':
      return 'Perform speech to text on this file'
    case 'image':
      return 'Extract the text from this image, reply with only the text'
    default:
      return null
  }
}
