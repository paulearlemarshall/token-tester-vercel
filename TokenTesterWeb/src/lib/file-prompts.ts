import { getSql } from './db'

export interface FilePrompt {
  id: number
  text: string
  file_type: string | null
  created_at: string
  updated_at: string
}

export interface FilePromptInput {
  text: string
  file_type?: string | null
}

const DEFAULTS: FilePromptInput[] = [
  { text: 'Extract the text from this document in order, reply with only the text', file_type: 'document' },
  { text: 'Perform speech to text on this audio file, reply with only the text', file_type: 'audio' },
  { text: 'Extract the text from this image, reply with only the text', file_type: 'image' },
]

let schemaReady = false

async function ensureSchema() {
  if (schemaReady) return
  const sql = getSql()
  await (sql as any)`
    create table if not exists file_prompts (
      id serial primary key,
      text text not null,
      file_type text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `
  schemaReady = true
}

async function seedDefaultsIfEmpty() {
  const sql = getSql() as any
  const rows = await sql`select count(*) as cnt from file_prompts`
  const count = Number(rows[0]?.cnt ?? 0)
  if (count > 0) return
  for (const d of DEFAULTS) {
    await sql`
      insert into file_prompts (text, file_type)
      values (${d.text}, ${d.file_type ?? null})
    `
  }
}

export async function listFilePrompts(): Promise<FilePrompt[]> {
  await ensureSchema()
  await seedDefaultsIfEmpty()
  const sql = getSql()
  const rows: any = await sql`
    select id, text, file_type, created_at, updated_at
    from file_prompts
    order by id asc
  `
  return rows as FilePrompt[]
}

export async function createFilePrompt(input: FilePromptInput): Promise<FilePrompt> {
  await ensureSchema()
  const sql = getSql()
  const rows: any = await sql`
    insert into file_prompts (text, file_type)
    values (${input.text}, ${input.file_type ?? null})
    returning id, text, file_type, created_at, updated_at
  `
  return rows[0] as FilePrompt
}

export async function updateFilePrompt(id: number, input: FilePromptInput): Promise<FilePrompt | null> {
  const sql = getSql()
  const rows: any = await sql`
    update file_prompts
    set text = ${input.text}, file_type = ${input.file_type ?? null}, updated_at = now()
    where id = ${id}
    returning id, text, file_type, created_at, updated_at
  `
  return (rows[0] ?? null) as FilePrompt | null
}

export async function deleteFilePrompt(id: number): Promise<boolean> {
  const sql = getSql()
  const rows: any = await sql`
    delete from file_prompts where id = ${id}
    returning id
  `
  return rows.length > 0
}

export function defaultPromptForFileType(fileType: string): string {
  switch (fileType) {
    case 'document':
      return 'Extract the text from this document in order, reply with only the text'
    case 'audio':
      return 'Perform speech to text on this audio file, reply with only the text'
    case 'image':
      return 'Extract the text from this image, reply with only the text'
    default:
      return 'Analyze this file'
  }
}
