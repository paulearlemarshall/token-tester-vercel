import type { AttachedFile } from '../types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.mpeg', '.mpg', '.wmv', '.flv'])
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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
}

const SUPPORTED_EXTS = new Set([...TEXT_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, '.pdf', '.docx'])

export function isSupportedUpload(file: File) {
  return SUPPORTED_EXTS.has(extensionOf(file.name))
}

export async function fileToAttached(file: File, pathOverride?: string): Promise<AttachedFile> {
  const ext = extensionOf(file.name)
  const path = pathOverride || (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
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

  if (AUDIO_EXTS.has(ext)) {
    entry.type = 'audio'
    entry.base64 = await readBase64(file)
    entry.mimeType = file.type || MIME_MAP[ext] || 'audio/mpeg'
    entry.content = `[Audio file: ${file.name} - ${(file.size / 1024).toFixed(1)} KB - binary content sent inline when supported]`
    return entry
  }

  if (VIDEO_EXTS.has(ext)) {
    entry.type = 'video'
    entry.base64 = await readBase64(file)
    entry.mimeType = file.type || MIME_MAP[ext] || 'video/mp4'
    entry.content = `[Video file: ${file.name} - ${(file.size / 1024).toFixed(1)} KB - binary content sent inline when supported]`
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

export interface DroppedFolder {
  name: string
  files: { file: File; path: string }[]
}

export interface DroppedFiles {
  files: File[]
  folders: DroppedFolder[]
  unsupportedFolderDrop: boolean
}

interface FileSystemEntry {
  name: string
  fullPath: string
  isFile: boolean
  isDirectory: boolean
}

interface FileSystemFileEntry extends FileSystemEntry {
  file: (success: (file: File) => void, error?: (err: DOMException) => void) => void
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader: () => FileSystemDirectoryReader
}

interface FileSystemDirectoryReader {
  readEntries: (success: (entries: FileSystemEntry[]) => void, error?: (err: DOMException) => void) => void
}

export async function dataTransferToDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFiles> {
  const folders = new Map<string, DroppedFolder>()
  const files: File[] = []
  let sawDirectory = false
  let unsupportedFolderDrop = false

  const items = Array.from(dataTransfer.items ?? [])
  const entries = items
    .map((item) => typeof item.webkitGetAsEntry === 'function'
      ? item.webkitGetAsEntry() as FileSystemEntry | null
      : null)
    .filter(Boolean) as FileSystemEntry[]

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isDirectory) {
        sawDirectory = true
        const folderFiles = await walkDirectory(entry as FileSystemDirectoryEntry, entry.name)
        if (folderFiles.length > 0) {
          folders.set(entry.name, { name: entry.name, files: folderFiles })
        }
        continue
      }

      if (entry.isFile) {
        files.push(await readEntryFile(entry as FileSystemFileEntry))
      }
    }
  } else {
    files.push(...Array.from(dataTransfer.files ?? []))
  }

  if (!sawDirectory && items.length > 0 && Array.from(dataTransfer.files ?? []).length === 0) {
    unsupportedFolderDrop = true
  }

  return { files, folders: Array.from(folders.values()), unsupportedFolderDrop }
}

async function walkDirectory(entry: FileSystemDirectoryEntry, basePath: string): Promise<{ file: File; path: string }[]> {
  const output: { file: File; path: string }[] = []
  for (const child of await readAllDirectoryEntries(entry)) {
    const childPath = `${basePath}/${child.name}`
    if (child.isDirectory) {
      output.push(...await walkDirectory(child as FileSystemDirectoryEntry, childPath))
    } else if (child.isFile) {
      output.push({ file: await readEntryFile(child as FileSystemFileEntry), path: childPath })
    }
  }
  return output
}

async function readAllDirectoryEntries(entry: FileSystemDirectoryEntry) {
  const reader = entry.createReader()
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) break
    entries.push(...batch)
  }
  return entries
}

function readEntryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject)
  })
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
