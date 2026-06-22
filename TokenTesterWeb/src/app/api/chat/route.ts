import { NextResponse } from 'next/server'
import { chatCompletion } from '@/lib/provider-api'

export async function POST(request: Request) {
  const params = await request.json()
  const result = await chatCompletion(params)
  return NextResponse.json(result)
}
