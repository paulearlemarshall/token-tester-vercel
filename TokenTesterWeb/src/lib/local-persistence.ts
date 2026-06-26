import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), '.local-data')

export function shouldUseLocalPersistence() {
  return !process.env.DATABASE_URL
}

export async function readLocalJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path.join(DATA_DIR, fileName), 'utf8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export async function writeLocalJson<T>(fileName: string, value: T): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(path.join(DATA_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function nextLocalId(rows: Array<{ id?: number }>) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id ?? 0)), 0) + 1
}
