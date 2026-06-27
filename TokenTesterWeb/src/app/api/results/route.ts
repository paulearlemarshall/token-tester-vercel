import { NextResponse } from 'next/server'
import { deleteRunResults, getRunResults, saveRunResult, updateRunResultsSuppressed } from '@/lib/run-results'

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

export async function PATCH(request: Request) {
  try {
    const input = await request.json()
    return NextResponse.json(await updateRunResultsSuppressed(input.ids ?? [], Boolean(input.suppressed)))
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const input = await request.json()
    return NextResponse.json(await deleteRunResults(input.ids ?? []))
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}
