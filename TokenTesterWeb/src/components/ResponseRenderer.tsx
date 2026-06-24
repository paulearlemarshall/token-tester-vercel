import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

export function ResponseRenderer({ value }: { value: string }) {
  return (
    <div className="response-markdown text-sm leading-relaxed text-surface-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          h1: props => <h1 className="mb-2 mt-4 text-lg font-bold text-surface-100" {...props} />,
          h2: props => <h2 className="mb-2 mt-4 text-base font-semibold text-surface-100" {...props} />,
          h3: props => <h3 className="mb-1 mt-3 text-sm font-semibold text-surface-100" {...props} />,
          p: props => <p className="mb-2 text-surface-300" {...props} />,
          a: props => <a className="text-brand-gold underline underline-offset-2 hover:text-brand-gold/80" target="_blank" rel="noreferrer" {...props} />,
          ul: props => <ul className="mb-3 ml-5 list-disc space-y-1" {...props} />,
          ol: props => <ol className="mb-3 ml-5 list-decimal space-y-1" {...props} />,
          li: props => <li className="text-surface-300" {...props} />,
          blockquote: props => <blockquote className="my-3 border-l-2 border-brand-gold/50 pl-3 text-surface-400" {...props} />,
          table: props => <div className="my-3 overflow-x-auto rounded-lg border border-surface-700"><table className="w-full border-collapse text-xs" {...props} /></div>,
          thead: props => <thead className="bg-surface-800 text-surface-200" {...props} />,
          th: props => <th className="border border-surface-700 px-3 py-2 text-left font-semibold" {...props} />,
          td: props => <td className="border border-surface-700 px-3 py-2 align-top" {...props} />,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className ?? '')
            const isBlock = Boolean(match)
            if (!isBlock) {
              return <code className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[11px] text-brand-gold" {...props}>{children}</code>
            }
            return <code className={`${className ?? ''} block font-mono text-xs text-surface-200`} {...props}>{children}</code>
          },
          pre: props => <pre className="my-3 overflow-x-auto rounded-lg bg-surface-950 p-3" {...props} />,
          strong: props => <strong className="font-semibold text-surface-100" {...props} />,
          em: props => <em className="text-surface-200" {...props} />,
        }}
      >
        {normalizeResponseMarkup(value)}
      </ReactMarkdown>
    </div>
  )
}

export function responseDisplayValue(response: any) {
  return cleanResponseText(extractUsefulText(response) || JSON.stringify(response?.responsePayload ?? response, null, 2))
}

function normalizeResponseMarkup(value: string) {
  const lines = value.split('\n')
  let inFence = false
  return lines.map(line => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    return line
      .replace(/\\boxed\{([^{}]+)\}/g, '$\\boxed{$1}$')
      .replace(/\\\((.+?)\\\)/g, '$$$1$$')
      .replace(/\\\[(.+?)\\\]/g, '$$$$\n$1\n$$$$')
  }).join('\n')
}

function extractUsefulText(value: any): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  const direct = firstText([
    value.responseText,
    value.content,
    value.text,
    value.output_text,
    value.answer,
    value.result,
    value.completion,
    value.response,
  ])
  if (direct) return direct

  const payload = value.responsePayload
  if (payload && payload !== value) {
    const fromPayload = extractProviderPayloadText(payload)
    if (fromPayload) return fromPayload
  }

  return extractProviderPayloadText(value) || findLikelyText(value)
}

function extractProviderPayloadText(payload: any): string {
  if (!payload || typeof payload !== 'object') return ''

  const openAiChoice = Array.isArray(payload.choices) ? payload.choices[0] : null
  const openAiMessage = openAiChoice?.message ?? openAiChoice?.delta ?? openAiChoice
  const openAiText = firstText([
    openAiMessage?.content,
    openAiMessage?.text,
    openAiMessage?.reasoning,
    openAiMessage?.refusal,
    openAiChoice?.text,
  ])
  if (openAiText) return openAiText

  const anthropicText = contentArrayText(payload.content)
  if (anthropicText) return anthropicText

  const geminiText = contentArrayText(payload.candidates?.[0]?.content?.parts)
  if (geminiText) return geminiText

  const xaiText = contentArrayText(payload.output?.flatMap((item: any) => item?.content ?? []) ?? [])
  if (xaiText) return xaiText

  return firstText([payload.output_text, payload.response, payload.answer, payload.result, payload.text, payload.content])
}

function firstText(values: any[]) {
  for (const value of values) {
    const text = textValue(value)
    if (text) return text
  }
  return ''
}

function textValue(value: any): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return contentArrayText(value)
  if (value && typeof value === 'object') {
    return firstText([value.text, value.content, value.output_text, value.response, value.answer])
  }
  return ''
}

function contentArrayText(value: any): string {
  if (!Array.isArray(value)) return ''
  return value
    .map(part => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      return firstText([part.text, part.content, part.output_text, part.response, part.answer])
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function findLikelyText(value: any, depth = 0): string {
  if (!value || depth > 5) return ''
  if (typeof value === 'string') return likelyHumanText(value) ? value.trim() : ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLikelyText(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const priorityKeys = ['response', 'answer', 'output', 'content', 'text', 'message', 'result', 'completion']
  for (const key of priorityKeys) {
    if (key in value) {
      const found = findLikelyText(value[key], depth + 1)
      if (found) return found
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    if (/request|usage|token|model|id|url|created|provider|payload/i.test(key)) continue
    const found = findLikelyText(nested, depth + 1)
    if (found) return found
  }
  return ''
}

function likelyHumanText(value: string) {
  const trimmed = value.trim()
  if (trimmed.length < 2) return false
  if (/^https?:\/\//i.test(trimmed)) return false
  if (/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) return false
  return /[\s.!?,;:\n]|<[a-z]/i.test(trimmed)
}

function cleanResponseText(value: string) {
  let text = value.trim()
  const wrappers = ['response', 'answer', 'final', 'final_answer', 'output', 'result']
  for (const tag of wrappers) {
    const pattern = new RegExp(`^<${tag}[^>]*>\\s*([\\s\\S]*?)\\s*<\\/${tag}>$`, 'i')
    const match = text.match(pattern)
    if (match) {
      text = match[1].trim()
      break
    }
  }
  return text
}
