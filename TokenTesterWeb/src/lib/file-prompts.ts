import { getSql } from './db'

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
  { text: 'Perform speech to text on this audio file, reply with only the text', is_default_audio: true },
  { text: 'Extract the text from this image, reply with only the text', is_default_image: true },
]

let schemaReady = false

async function ensureSchema() {
  if (schemaReady) return
  const sql = getSql() as any
  await sql`
    create table if not exists file_prompts (
      id serial primary key,
      text text not null,
      is_default_document boolean not null default false,
      is_default_image boolean not null default false,
      is_default_audio boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  await sql`alter table file_prompts drop column if exists file_type`.catch(() => {})
  schemaReady = true
}

async function seedDefaultsIfEmpty() {
  const sql = getSql() as any
  const rows = await sql`select count(*) as cnt from file_prompts`
  const count = Number(rows[0]?.cnt ?? 0)
  if (count > 0) return
  for (const d of DEFAULTS) {
    await sql`
      insert into file_prompts (text, is_default_document, is_default_image, is_default_audio)
      values (${d.text}, ${d.is_default_document ?? false}, ${d.is_default_image ?? false}, ${d.is_default_audio ?? false})
    `
  }
}

async function ensureDefaultUniqueness(sql: any, type: string, excludeId?: number) {
  if (excludeId) {
    await sql(`update file_prompts set ${type} = false where ${type} = true and id != ${excludeId}`)
  } else {
    await sql(`update file_prompts set ${type} = false where ${type} = true`)
  }
}

export async function listFilePrompts(): Promise<FilePrompt[]> {
  await ensureSchema()
  await seedDefaultsIfEmpty()
  const sql = getSql() as any
  const rows = await sql`
    select id, text, is_default_document, is_default_image, is_default_audio, created_at, updated_at
    from file_prompts
    order by id asc
  `
  return rows as FilePrompt[]
}

export async function getDefaults(): Promise<FilePromptDefaults> {
  await ensureSchema()
  const sql = getSql() as any
  const rows: any[] = await sql`
    select id, text, is_default_document, is_default_image, is_default_audio
    from file_prompts
    where is_default_document = true or is_default_image = true or is_default_audio = true
  `
  return {
    document: rows.find((r: any) => r.is_default_document) ?? null,
    image: rows.find((r: any) => r.is_default_image) ?? null,
    audio: rows.find((r: any) => r.is_default_audio) ?? null,
  }
}

export async function createFilePrompt(input: FilePromptInput): Promise<FilePrompt> {
  await ensureSchema()
  const sql = getSql() as any

  for (const flag of ['is_default_document', 'is_default_image', 'is_default_audio'] as const) {
    if (input[flag]) await ensureDefaultUniqueness(sql, flag)
  }

  const rows = await sql`
    insert into file_prompts (text, is_default_document, is_default_image, is_default_audio)
    values (${input.text}, ${input.is_default_document ?? false}, ${input.is_default_image ?? false}, ${input.is_default_audio ?? false})
    returning id, text, is_default_document, is_default_image, is_default_audio, created_at, updated_at
  `
  return rows[0] as FilePrompt
}

export async function updateFilePrompt(id: number, input: FilePromptInput): Promise<FilePrompt | null> {
  const sql = getSql() as any

  for (const flag of ['is_default_document', 'is_default_image', 'is_default_audio'] as const) {
    if (input[flag]) await ensureDefaultUniqueness(sql, flag, id)
  }

  const rows = await sql`
    update file_prompts
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
  const sql = getSql() as any
  const rows = await sql`
    delete from file_prompts where id = ${id}
    returning id
  `
  return rows.length > 0
}

export function defaultPromptForFileType(fileType: string): string | null {
  switch (fileType) {
    case 'document':
      return 'Extract the text from this document in order, reply with only the text'
    case 'audio':
      return 'Perform speech to text on this audio file, reply with only the text'
    case 'image':
      return 'Extract the text from this image, reply with only the text'
    default:
      return null
  }
}
