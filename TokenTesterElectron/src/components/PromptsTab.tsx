import { useState } from 'react'
import { Paperclip, FolderOpen, X, Eye, EyeOff, FileIcon, ImageIcon, FileTextIcon, Plus, ToggleLeft, ToggleRight, MessageSquare, FolderIcon, Layers, File, CheckSquare, Square } from 'lucide-react'
import { useStore } from '../store'
import { formatFileSize, truncate } from '../utils/formatters'
import type { AttachedFile, FileItem } from '../types'

declare global { interface Window { electronAPI: any } }

function makeAttached(entry: any): AttachedFile {
  return {
    id: crypto.randomUUID(),
    name: entry.name,
    path: entry.path,
    size: entry.size,
    ext: entry.ext,
    type: entry.type ?? 'text',
    content: entry.content,
    base64: entry.base64,
    mimeType: entry.mimeType,
    enabled: true,
  }
}

export function PromptsTab() {
  const {
    systemPrompt, setSystemPrompt,
    customPrompts, addPrompt, updatePrompt, removePrompt,
    fileItems, addFileItem, removeFileItem, updateFileItem, toggleFileEnabled, clearFileItems,
  } = useStore()
  const [loading, setLoading] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [newPromptText, setNewPromptText] = useState('')

  function handleAddPrompt() {
    const text = newPromptText.trim()
    if (!text) return
    addPrompt(text)
    setNewPromptText('')
  }

  async function handlePickFiles() {
    setLoading(true)
    try {
      const paths = await window.electronAPI.pickFiles()
      for (const p of paths) {
        const raw = await window.electronAPI.readFile(p)
        const file = makeAttached(raw)
        const item: FileItem = {
          id: crypto.randomUUID(),
          kind: 'file',
          name: file.name,
          path: file.path,
          prompt: 'Extract the information from this document, reply with only the information.',
          size: file.size,
          fileCount: 1,
          file,
          mode: 'single',
        }
        addFileItem(item)
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  async function handlePickDir() {
    setLoading(true)
    try {
      const dir = await window.electronAPI.pickDir()
      if (!dir) { setLoading(false); return }
      const entries = await window.electronAPI.listDirRecursive(dir)
      const files: AttachedFile[] = []
      for (const e of entries) {
        const raw = await window.electronAPI.readFile(e.path)
        files.push(makeAttached(raw))
      }
      const folderName = dir.split(/[/\\]/).pop() ?? dir
      const item: FileItem = {
        id: crypto.randomUUID(),
        kind: 'folder',
        name: folderName,
        path: dir,
        prompt: 'Extract the information from this document, reply with only the information.',
        size: files.reduce((s, f) => s + f.size, 0),
        fileCount: files.length,
        files,
        mode: 'single',
      }
      addFileItem(item)
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  function iconForType(t: string) {
    switch (t) {
      case 'image': return <ImageIcon size={16} className="text-purple-400" />
      case 'text': return <FileTextIcon size={16} className="text-blue-400" />
      default: return <FileIcon size={16} className="text-surface-400" />
    }
  }

  const previewFile = fileItems.flatMap(f => f.kind === 'folder' ? (f.files ?? []) : (f.file ? [f.file] : [])).find(f => f.path === previewPath)

  const enabledPrompts = customPrompts.filter((p: any) => p.enabled).length
  const fileCount = fileItems.reduce((s, f) => s + (f.kind === 'folder' ? (f.files?.length ?? 0) : 1), 0)
  const enabledFileCount = fileItems.reduce((s, f) => s + (f.kind === 'folder' ? (f.files?.filter(ff => ff.enabled !== false).length ?? 0) : 1), 0)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-100">Prompts & Files</h2>
        <p className="text-sm text-surface-400 mt-1">
          {enabledPrompts} data prompt{enabledPrompts !== 1 ? 's' : ''} · {fileItems.length} item{fileItems.length !== 1 ? 's' : ''} · {enabledFileCount} file{enabledFileCount !== 1 ? 's' : ''}
        </p>
      </div>

      <div>
        <label className="label">System Prompt <span className="text-surface-500 font-normal">(optional — prepended to all runs)</span></label>
        <textarea
          className="input font-mono text-sm min-h-[80px] resize-y"
          placeholder="You are a helpful assistant..."
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Custom Prompts <span className="text-surface-400 font-normal text-xs">(your plain input text for analysis)</span></label>
          <span className="text-xs text-surface-500">{customPrompts.filter((p: any) => p.enabled).length} of {customPrompts.length} enabled</span>
        </div>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1"
            placeholder="Type a prompt and press Add..."
            value={newPromptText}
            onChange={e => setNewPromptText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddPrompt() }}
          />
          <button onClick={handleAddPrompt} className="btn-primary flex items-center gap-1 text-sm whitespace-nowrap">
            <Plus size={14} /> Add Prompt
          </button>
        </div>
        {customPrompts.length === 0 ? (
          <div className="card text-center py-6">
            <FileTextIcon size={20} className="mx-auto text-surface-500 mb-1" />
            <p className="text-surface-400 text-sm">No data prompts yet</p>
            <p className="text-surface-500 text-xs">Each prompt becomes a separate test case (plain text input for analysis)</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {customPrompts.map((p: any) => (
              <div key={p.id} className="card flex items-start gap-2 py-2 px-3">
                <button
                  onClick={() => updatePrompt(p.id, { enabled: !p.enabled })}
                  className="mt-0.5 text-surface-400 hover:text-surface-200 shrink-0"
                >
                  {p.enabled ? <ToggleRight size={18} className="text-indigo-400" /> : <ToggleLeft size={18} />}
                </button>
                <MessageSquare size={14} className="text-surface-500 mt-1 shrink-0" />
                <input
                  className="input text-xs flex-1 bg-transparent border-0 px-0 py-0 resize-none"
                  value={p.text}
                  onChange={e => updatePrompt(p.id, { text: e.target.value })}
                />
                <button onClick={() => removePrompt(p.id)} className="text-surface-400 hover:text-red-400 shrink-0 mt-0.5">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Files & Folders <span className="text-surface-400 font-normal text-xs">(attach a per-item prompt for each)</span></label>
          <div className="flex gap-2">
            <button onClick={handlePickFiles} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-xs">
              <Paperclip size={14} /> Attach Files
            </button>
            <button onClick={handlePickDir} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-xs">
              <FolderOpen size={14} /> Stage Folder
            </button>
            {fileItems.length > 0 && (
              <button onClick={clearFileItems} className="btn-danger text-xs">Clear All</button>
            )}
          </div>
        </div>

        {fileItems.length === 0 ? (
          <div className="card text-center py-8">
            <Paperclip size={24} className="mx-auto text-surface-500 mb-2" />
            <p className="text-surface-400 text-sm">No files or folders attached</p>
            <p className="text-surface-500 text-xs mt-1">Attach files or stage a folder — each can have its own prompt</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {fileItems.map((item: FileItem) => (
              <div key={item.id} className="card p-3 space-y-2">
                <div className="flex items-start gap-3">
                  {item.kind === 'folder' ? (
                    <FolderIcon size={20} className="text-yellow-500 shrink-0 mt-0.5" />
                  ) : (
                    iconForType(item.file?.type ?? 'text')
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-surface-200 truncate">{item.name}</span>
                      {item.kind === 'folder' && (
                        <span className="badge-gray text-[10px]">{item.fileCount} files</span>
                      )}
                    </div>
                    <p className="text-xs text-surface-400">{formatFileSize(item.size)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.kind === 'folder' && (
                      <div className="flex bg-surface-800 rounded-md p-0.5 border border-surface-700 mr-1">
                        <button
                          onClick={() => updateFileItem(item.id, { mode: 'batch' })}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${item.mode === 'batch' ? 'bg-indigo-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
                        >
                          Batch
                        </button>
                        <button
                          onClick={() => updateFileItem(item.id, { mode: 'single' })}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${item.mode === 'single' ? 'bg-indigo-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
                        >
                          Single
                        </button>
                      </div>
                    )}
                    <button onClick={() => removeFileItem(item.id)} className="text-surface-400 hover:text-red-400">
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pl-7">
                  {item.prompt ? (
                    <>
                      <MessageSquare size={14} className="text-indigo-400 shrink-0" />
                      <input
                        className="input text-xs flex-1 bg-surface-800 py-1 h-7"
                        value={item.prompt}
                        onChange={e => updateFileItem(item.id, { prompt: e.target.value })}
                        placeholder="Attached prompt..."
                      />
                      <button
                        onClick={() => updateFileItem(item.id, { prompt: '' })}
                        className="text-surface-400 hover:text-red-400 shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => updateFileItem(item.id, { prompt: ' ' })}
                      className="text-xs text-surface-400 hover:text-indigo-400 flex items-center gap-1 pl-7"
                    >
                      <Plus size={12} /> Add prompt
                    </button>
                  )}
                </div>

                {item.kind === 'folder' && item.files && item.files.length > 0 && (
                  <div className="pl-7 space-y-0.5">
                    {item.files.slice(0, 10).map((f: AttachedFile) => (
                      <div key={f.id} className="flex items-center gap-1.5 text-xs text-surface-500">
                        <button
                          onClick={() => toggleFileEnabled(item.id, f.id)}
                          className="shrink-0 hover:text-surface-200"
                          title={f.enabled !== false ? 'Click to exclude' : 'Click to include'}
                        >
                          {f.enabled !== false ? <CheckSquare size={13} className="text-indigo-400" /> : <Square size={13} />}
                        </button>
                        {iconForType(f.type)}
                        <span className={`truncate flex-1 ${f.enabled === false ? 'text-surface-600 line-through' : ''}`}>{f.name}</span>
                        <button
                          onClick={() => setPreviewPath(previewPath === f.path ? null : f.path)}
                          className="hover:text-surface-200"
                        >
                          {previewPath === f.path ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    ))}
                    {item.files.length > 10 && (
                      <div className="text-xs text-surface-600 italic">...and {item.files.length - 10} more</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {previewFile && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-surface-300">{previewFile.name}</h3>
            <button onClick={() => setPreviewPath(null)} className="text-surface-400 hover:text-surface-200">
              <X size={16} />
            </button>
          </div>
          <pre className="text-xs text-surface-300 bg-surface-950 rounded p-3 max-h-64 overflow-auto font-mono whitespace-pre-wrap">
            {previewFile.type === 'image' ? (
              <img src={`data:${previewFile.mimeType};base64,${previewFile.base64}`} alt={previewFile.name} className="max-w-full max-h-64 rounded" />
            ) : (
              truncate(previewFile.content ?? '[empty]', 2000)
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
