import { ipcMain, dialog, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { Buffer } from 'buffer'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.sh', '.bash', '.zsh', '.env', '.cfg', '.ini', '.toml',
  '.sql', '.r', '.m', '.swift', '.kt', '.scala', '.lua', '.php', '.vue', '.svelte',
])

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
}

const SUPPORTED_EXTS = new Set([...TEXT_EXTS, ...IMAGE_EXTS, '.pdf', '.docx'])

function isSupported(ext: string) {
  return SUPPORTED_EXTS.has(ext)
}

function extractImageDimensions(buf: Buffer): { width?: number; height?: number } {
  if (buf.length < 24) return {}
  const head = buf.readUInt8(0)
  if (head === 0x89 && buf.readUInt8(1) === 0x50) {
    // PNG
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (head === 0xFF && buf.readUInt8(1) === 0xD8) {
    // JPEG — scan for SOF marker (0xFF 0xC0 or 0xFF 0xC2)
    let i = 2
    while (i < buf.length - 9) {
      if (buf.readUInt8(i) === 0xFF && (buf.readUInt8(i + 1) === 0xC0 || buf.readUInt8(i + 1) === 0xC2)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i++
    }
    return {}
  }
  if (head === 0x47) {
    // GIF
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (head === 0x42) {
    // BMP
    return { width: buf.readUInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
  }
  if (buf.length > 30 && buf.readUInt32BE(0) === 0x52494646) {
    // WebP (RIFF header)
    const fourCC = buf.toString('ascii', 8, 12)
    if (fourCC === 'VP8 ' && buf.length > 30) {
      return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF }
    }
    if (fourCC === 'VP8L' && buf.length > 25) {
      const n = buf.readUInt32LE(21)
      return { width: (n & 0x3FFF) + 1, height: ((n >> 14) & 0x3FFF) + 1 }
    }
    if (fourCC === 'VP8X' && buf.length > 24) {
      const width = buf.readUIntLE(24, 3) + 1
      const height = buf.readUIntLE(27, 3) + 1
      return { width, height }
    }
  }
  return {}
}

function extractPdfMetadata(buf: Buffer): Record<string, string> {
  const meta: Record<string, string> = {}
  try {
    const text = buf.toString('utf-8')
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g)
    meta.pages = String(pageMatches?.length || 1)
    meta.type = /\/Font\b/.test(text) || /\bTj\b/.test(text) || /\bTJ\b/.test(text) || /\bBT\b/.test(text)
      ? 'digital'
      : 'scanned'
  } catch {
    meta.pages = '1'
    meta.type = 'unknown'
  }
  return meta
}

export function registerFileHandlers() {
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase()
    const stats = await fs.stat(filePath)

    const entry: any = {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      ext,
    }

    if (IMAGE_EXTS.has(ext)) {
      const buffer = await fs.readFile(filePath)
      entry.type = 'image'
      entry.base64 = buffer.toString('base64')
      entry.mimeType = MIME_MAP[ext] ?? 'image/png'
      const dims = extractImageDimensions(buffer)
      if (dims.width || dims.height) {
        entry.metadata = { width: String(dims.width), height: String(dims.height) }
      }
    } else if (TEXT_EXTS.has(ext)) {
      entry.type = 'text'
      try {
        entry.content = await fs.readFile(filePath, 'utf-8')
      } catch {
        entry.content = `[Unable to read ${ext} file]`
      }
    } else if (ext === '.pdf' || ext === '.docx') {
      const buffer = await fs.readFile(filePath)
      entry.type = 'document'
      entry.base64 = buffer.toString('base64')
      entry.mimeType = ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      entry.content = `[${ext.toUpperCase()} file: ${path.basename(filePath)} — ${(stats.size / 1024).toFixed(1)} KB — binary content sent inline]`
      if (ext === '.pdf') {
        entry.metadata = extractPdfMetadata(buffer)
      }
    } else {
      entry.type = 'unknown'
      entry.content = `[Unsupported: ${ext}]`
    }

    return entry
  })

  ipcMain.handle('file:listDir', async (_event, dirPath: string) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = []
    for (const e of entries) {
      if (!e.isFile()) continue
      const ext = path.extname(e.name).toLowerCase()
      if (!isSupported(ext)) continue
      try {
        const stat = await fs.stat(path.join(dirPath, e.name))
        files.push({ name: e.name, path: path.join(dirPath, e.name), size: stat.size, ext })
      } catch { /* skip */ }
    }
    return files
  })

  ipcMain.handle('file:listDirRecursive', async (_event, dirPath: string) => {
    const result: any[] = []
    await walkDir(dirPath, result)
    return result
  })

  ipcMain.handle('file:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported', extensions: ['txt', 'md', 'json', 'csv', 'pdf', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'xml', 'yaml', 'yml', 'sh'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return result.filePaths
  })

  ipcMain.handle('file:pickDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] || null
  })

  ipcMain.handle('file:openFile', async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath)
    } catch { /* ignore */ }
  })
}

async function walkDir(dirPath: string, result: any[], prefix = '') {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const e of entries) {
      const fullPath = path.join(dirPath, e.name)
      if (e.isDirectory()) {
        await walkDir(fullPath, result, path.join(prefix, e.name))
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!isSupported(ext)) continue
        try {
          const stat = await fs.stat(fullPath)
          result.push({
            name: path.join(prefix, e.name),
            path: fullPath,
            size: stat.size,
            ext,
          })
        } catch { /* skip */ }
      }
    }
  } catch { /* skip inaccessible dirs */ }
}
