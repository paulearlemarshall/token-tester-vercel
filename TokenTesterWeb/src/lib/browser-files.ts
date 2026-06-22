import type { AttachedFile } from '../types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.sh', '.bash', '.zsh', '.env', '.cfg', '.ini', '.toml',
  '.sql', '.r', '.m', '.swift', '.kt', '.scala', '.lua', '.php', '.vue', '.svelte',
])

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

const SUPPORTED_EXTS = new Set([...TEXT_EXTS, ...IMAGE_EXTS, '.pdf', '.docx'])

export function isSupportedUpload(file: File) {
  return SUPPORTED_EXTS.has(extensionOf(file.name))
}

export async function fileToAttached(file: File): Promise<AttachedFile> {
  const ext = extensionOf(file.name)
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  const entry: AttachedFile = {
    id: crypto.randomUUID(),
    name: file.name,
    path,
    size: file.size,
    ext,
    type: 'unknown',
    enabled: true,
  }

  if (IMAGE_EXTS.has(ext)) {
    entry.type = 'image'
    entry.base64 = await readBase64(file)
    entry.mimeType = file.type || MIME_MAP[ext] || 'image/png'
    return entry
  }

  if (TEXT_EXTS.has(ext)) {
    entry.type = 'text'
    try {
      entry.content = await file.text()
    } catch {
      entry.content = `[Unable to read ${ext} file]`
    }
    return entry
  }

  if (ext === '.pdf' || ext === '.docx') {
    entry.type = 'document'
    entry.base64 = await readBase64(file)
    entry.mimeType = ext === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    entry.content = `[${ext.toUpperCase()} file: ${file.name} - ${(file.size / 1024).toFixed(1)} KB - binary content sent inline]`
    return entry
  }

  entry.content = `[Unsupported: ${ext}]`
  return entry
}

function extensionOf(name: string) {
  const idx = name.lastIndexOf('.')
  return idx === -1 ? '' : name.slice(idx).toLowerCase()
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
