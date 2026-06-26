import type { ArchivedRunResult } from '../types'

export interface ModelStatsRow {
  key: string
  providerName: string
  model: string
  documentType: string
  documentCategory: string
  runs: number
  successRate: number
  averageTotalTokens: number
  averageCost: number
  averageLatencyMs: number
  averageFileSize: number
  averageExtractedFeatureCount: number
  costPerExtractedFeature: number | null
  totalCost: number
  lastRunTimestamp: string
  averageDocumentCategoryConfidence: number | null
}

export function buildModelStatsRows(records: ArchivedRunResult[]): ModelStatsRow[] {
  const groups = new Map<string, { rows: ArchivedRunResult[]; providerName: string; model: string; documentType: string; documentCategory: string }>()
  for (const record of records) {
    if (record.suppressed) continue
    const documentType = inferDocumentType(record)
    const documentCategory = record.documentCategory || 'Uncategorized'
    const key = [record.providerName, record.model, documentType, documentCategory].join('||')
    const group = groups.get(key) ?? { rows: [], providerName: record.providerName, model: record.model, documentType, documentCategory }
    group.rows.push(record)
    groups.set(key, group)
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const rows = group.rows
    const successful = rows.filter(row => row.status === 'success')
    const totalCost = sum(rows, row => row.estimatedCost ?? 0)
    const featureCounts = successful.map(row => estimateExtractedFeatureCount(row.responseText ?? '')).filter(count => count > 0)
    const totalFeatures = featureCounts.reduce((a, b) => a + b, 0)
    const confidences = rows.map(row => row.documentCategoryConfidence).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return {
      key,
      providerName: group.providerName,
      model: group.model,
      documentType: group.documentType,
      documentCategory: group.documentCategory,
      runs: rows.length,
      successRate: rows.length ? successful.length / rows.length : 0,
      averageTotalTokens: average(rows, row => row.totalTokens ?? 0),
      averageCost: average(rows, row => row.estimatedCost ?? 0),
      averageLatencyMs: average(rows, row => row.latencyMs ?? 0),
      averageFileSize: average(rows, row => row.fileSize ?? inferredPayloadSize(row)),
      averageExtractedFeatureCount: featureCounts.length ? totalFeatures / featureCounts.length : 0,
      costPerExtractedFeature: totalFeatures > 0 ? totalCost / totalFeatures : null,
      totalCost,
      lastRunTimestamp: rows.map(row => row.completedAt).sort().at(-1) ?? '',
      averageDocumentCategoryConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
    }
  }).sort((a, b) => b.lastRunTimestamp.localeCompare(a.lastRunTimestamp))
}

export function inferDocumentType(record: ArchivedRunResult): string {
  if (record.sourceType === 'prompt') return 'Prompt only'
  if (record.sourceType === 'batch' || record.fileType === 'batch' || record.batchFiles) return 'Batch'
  const mime = (record.fileMimeType || '').toLowerCase()
  const fileType = (record.fileType || '').toLowerCase()
  const name = (record.fileName || '').toLowerCase()
  if (record.pdfSent || mime.includes('pdf') || name.endsWith('.pdf')) return 'PDF'
  if (record.imageSent || fileType === 'image' || mime.startsWith('image/')) return 'Image'
  if (record.audioSent || fileType === 'audio' || mime.startsWith('audio/')) return 'Audio'
  if (record.videoSent || fileType === 'video' || mime.startsWith('video/')) return 'Video'
  if (fileType === 'text' || mime.startsWith('text/') || /\.(txt|csv|json|md)$/i.test(name)) return 'Text'
  if (fileType === 'document' || /\.(docx?|xlsx?|pptx?)$/i.test(name)) return 'Document'
  return record.fileName ? 'Unknown' : 'Prompt only'
}

export function estimateExtractedFeatureCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  try {
    return countJsonLeaves(JSON.parse(trimmed))
  } catch {}
  const labeled = trimmed.split(/\r?\n/).filter(line => /^[A-Za-z][\w\s/-]{1,60}:\s+\S/.test(line)).length
  if (labeled > 0) return labeled
  return trimmed.split(/\r?\n/).filter(line => /^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)).length
}

function countJsonLeaves(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countJsonLeaves(item), 0)
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + countJsonLeaves(item), 0)
  return value == null || value === '' ? 0 : 1
}

function average(rows: ArchivedRunResult[], fn: (row: ArchivedRunResult) => number) {
  if (rows.length === 0) return 0
  return sum(rows, fn) / rows.length
}

function sum(rows: ArchivedRunResult[], fn: (row: ArchivedRunResult) => number) {
  return rows.reduce((total, row) => total + fn(row), 0)
}

function inferredPayloadSize(record: ArchivedRunResult) {
  return (record.pdfFileSize ?? 0) + (record.imageFileSize ?? 0) + (record.audioFileSize ?? 0) + (record.videoFileSize ?? 0)
}
