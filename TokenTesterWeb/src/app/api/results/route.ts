import { NextResponse } from 'next/server'
import { getRunResults, saveRunResult } from '@/lib/run-results'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 1000)
    return NextResponse.json(await getRunResults(limit))
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err), records: [] }, { status: 503 })
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json()
    return NextResponse.json(await saveRunResult(input))
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}
