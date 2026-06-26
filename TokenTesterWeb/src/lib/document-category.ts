import type { ArchivedRunResult } from '../types'

export const DOCUMENT_CATEGORIES = [
  'Utility bill',
  'Invoice',
  'Receipt',
  'Medical record',
  'Bank statement',
  'Contract',
  'ID document',
  'Tax document',
  'Form',
  'Email',
  'Resume',
  'Uncategorized',
] as const

export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number]

export interface DocumentCategoryInput {
  fileName?: string | null
  filePath?: string | null
  sourceLabel?: string | null
  userMessage?: string | null
  responseText?: string | null
  fileContent?: string | null
  metadata?: unknown
}

export interface DocumentCategoryResult {
  category: DocumentCategory
  confidence: number
  source: 'ai' | 'heuristic'
}

const CATEGORY_PATTERNS: Array<{ category: DocumentCategory; confidence: number; patterns: RegExp[] }> = [
  { category: 'Utility bill', confidence: 0.86, patterns: [/utility|electric|electricity|gas bill|water bill|telecom|phone bill|internet bill|meter|kwh/i] },
  { category: 'Invoice', confidence: 0.88, patterns: [/invoice|tax invoice|amount due|payment terms|bill to|invoice number|invoice #/i] },
  { category: 'Receipt', confidence: 0.84, patterns: [/receipt|paid with|subtotal|cashier|merchant|transaction id|thank you for your purchase/i] },
  { category: 'Medical record', confidence: 0.84, patterns: [/medical|patient|diagnosis|prescription|clinical|lab result|health|hospital|doctor/i] },
  { category: 'Bank statement', confidence: 0.88, patterns: [/bank statement|account statement|opening balance|closing balance|transaction date|iban|sort code/i] },
  { category: 'Contract', confidence: 0.82, patterns: [/contract|agreement|terms and conditions|party|parties|whereas|signature|effective date/i] },
  { category: 'ID document', confidence: 0.83, patterns: [/passport|driver'?s license|identity card|national id|date of birth|id number|expiry date/i] },
  { category: 'Tax document', confidence: 0.85, patterns: [/tax return|tax document|w-2|1099|vat return|irs|hmrc|tax year/i] },
  { category: 'Form', confidence: 0.74, patterns: [/application form|registration form|form\b|please complete|checkbox|signature date/i] },
  { category: 'Email', confidence: 0.78, patterns: [/^from:|^to:|^subject:|sent from my|dear .+,$/im] },
  { category: 'Resume', confidence: 0.85, patterns: [/resume|curriculum vitae|\bcv\b|work experience|education|skills|employment history/i] },
]

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(value)
}

export function heuristicDocumentCategory(input: DocumentCategoryInput): DocumentCategoryResult {
  const haystack = [
    input.fileName,
    input.filePath,
    input.sourceLabel,
    input.userMessage,
    input.responseText,
    input.fileContent,
    metadataText(input.metadata),
  ].filter(Boolean).join('\n')

  for (const candidate of CATEGORY_PATTERNS) {
    if (candidate.patterns.some(pattern => pattern.test(haystack))) {
      return { category: candidate.category, confidence: candidate.confidence, source: 'heuristic' }
    }
  }
  return { category: 'Uncategorized', confidence: 0.35, source: 'heuristic' }
}

export function categoryInputFromRecord(record: ArchivedRunResult): DocumentCategoryInput {
  return {
    fileName: record.fileName,
    filePath: record.filePath,
    sourceLabel: record.sourceLabel,
    userMessage: record.userMessage,
    responseText: record.responseText,
    metadata: record.fileMetadata,
  }
}

function metadataText(value: unknown): string {
  if (!value) return ''
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return ''
  }
}
