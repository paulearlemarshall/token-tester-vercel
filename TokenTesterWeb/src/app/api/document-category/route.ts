import { NextResponse } from 'next/server'
import {
  DOCUMENT_CATEGORIES,
  heuristicDocumentCategory,
  isDocumentCategory,
  type DocumentCategoryInput,
  type DocumentCategoryResult,
} from '@/lib/document-category'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const input = await request.json() as DocumentCategoryInput
    const heuristic = heuristicDocumentCategory(input)
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return NextResponse.json(heuristic)

    const ai = await classifyWithOpenAI(input, apiKey).catch(() => null)
    return NextResponse.json(ai ?? heuristic)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 400 })
  }
}

async function classifyWithOpenAI(input: DocumentCategoryInput, apiKey: string): Promise<DocumentCategoryResult | null> {
  const model = process.env.DOCUMENT_CATEGORY_MODEL || 'gpt-4o-mini'
  const prompt = [
    'Classify this document into exactly one allowed category.',
    `Allowed categories: ${DOCUMENT_CATEGORIES.join(', ')}`,
    'Return only JSON with keys category and confidence, where confidence is 0 to 1.',
    '',
    `File name: ${input.fileName ?? ''}`,
    `File path: ${input.filePath ?? ''}`,
    `Source label: ${input.sourceLabel ?? ''}`,
    `User prompt: ${truncate(input.userMessage, 1200)}`,
    `Metadata: ${truncate(safeJson(input.metadata), 1200)}`,
    `File content: ${truncate(input.fileContent, 2500)}`,
    `Response text: ${truncate(input.responseText, 2500)}`,
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      max_output_tokens: 160,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const text = extractResponseText(data)
  if (!text) return null
  let parsed: any
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
  } catch {
    return null
  }
  if (!isDocumentCategory(parsed.category)) return null
  const confidence = Number(parsed.confidence)
  return {
    category: parsed.category,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    source: 'ai',
  }
}

function extractResponseText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text
  const parts = data?.output?.flatMap((item: any) => item?.content ?? []) ?? []
  return parts.map((part: any) => part?.text ?? '').filter(Boolean).join('\n')
}

function truncate(value: unknown, max: number) {
  const text = value == null ? '' : String(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function safeJson(value: unknown) {
  if (value == null) return ''
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return ''
  }
}
