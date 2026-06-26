import { NextResponse } from 'next/server'
import { deleteModelPreset, listModelPresets, upsertModelPreset } from '@/lib/model-presets'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const presets = await listModelPresets()
    return NextResponse.json({ presets })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err), presets: [] }, { status: 503 })
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json()
    const preset = await upsertModelPreset(payload)
    return NextResponse.json(preset)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json()
    const id = Number(payload.id)
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const deleted = await deleteModelPreset(id)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}
