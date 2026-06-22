export function formatCurrency(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.0001) return `$${n.toExponential(2)}`
  return `$${n.toFixed(6).replace(/\.?0+$/, '')}`
}

export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function estimateCost(inputTokens: number, outputTokens: number, rate: { input: number; output: number; per: string } | null): number {
  if (!rate) return 0
  const divisor = rate.per === '1K' ? 1000 : 1_000_000
  return (inputTokens / divisor) * rate.input + (outputTokens / divisor) * rate.output
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}
