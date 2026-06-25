import { NextResponse } from 'next/server'
import { listFilePrompts, getDefaults, createFilePrompt, updateFilePrompt, deleteFilePrompt } from '@/lib/file-prompts'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [prompts, defaults] = await Promise.all([listFilePrompts(), getDefaults()])
    return NextResponse.json({ prompts, defaults })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 503 })
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const result = await createFilePrompt(payload)
    return NextResponse.json(result, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json()
    const { id, ...input } = payload
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const result = await updateFilePrompt(id, input)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json()
    const { id } = payload
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const deleted = await deleteFilePrompt(id)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}
