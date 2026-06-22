import { neon } from '@neondatabase/serverless'

let sqlClient: ReturnType<typeof neon> | null = null

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL)
  }
  return sqlClient
}
