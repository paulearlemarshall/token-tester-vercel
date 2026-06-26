import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Paperclip, FolderOpen, X, Eye, EyeOff, FileIcon, ImageIcon, FileTextIcon, FileAudio, FileVideo, Plus, ToggleLeft, ToggleRight, MessageSquare, FolderIcon, CheckSquare, Square, UploadCloud } from 'lucide-react'
import { useStore } from '../store'
import { formatFileSize, truncate } from '../utils/formatters'
import type { AttachedFile, FileItem } from '../types'
import { dataTransferToDroppedFiles, fileToAttached, isSupportedUpload } from '../lib/browser-files'

const DEFAULT_AUDIO_PROMPT = 'Perform speech to text on this file'

export function PromptsTab() {
  const {
    systemPrompt, setSystemPrompt,
    customPrompts, addPrompt, updatePrompt, removePrompt,
    fileItems, addFileItem, removeFileItem, updateFileItem, toggleFileEnabled, clearFileItems,
  } = useStore()
  const [loading, setLoading] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [newPromptText, setNewPromptText] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [filePrompts, setFilePrompts] = useState<{ id: number; text: string; is_default_document: boolean; is_default_image: boolean; is_default_audio: boolean }[]>([])
  const [defaults, setDefaults] = useState<Record<string, { id: number; text: string } | null>>({ document: null, image: null, audio: null })
  const [fpEditorId, setFpEditorId] = useState<number | null>(null)
  const [fpEditorText, setFpEditorText] = useState('')
  const [fpDefaultDoc, setFpDefaultDoc] = useState(false)
  const [fpDefaultImg, setFpDefaultImg] = useState(false)
  const [fpDefaultAud, setFpDefaultAud] = useState(false)
  const [fpSaveError, setFpSaveError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  function loadFilePrompts() {
    fetch('/api/file-prompts')
      .then(res => res.json())
      .then(data => {
        if (data.prompts) setFilePrompts(data.prompts)
        if (data.defaults) setDefaults(data.defaults)
      })
      .catch(err => console.error('Failed to load file prompts', err))
  }

  useEffect(loadFilePrompts, [])

  function handleAddPrompt() {
    const text = newPromptText.trim()
    if (!text) return
    addPrompt(text)
    setNewPromptText('')
  }

  function defaultPromptByType(t: string): string {
    const d = t === 'document' ? defaults.document : t === 'audio' ? defaults.audio : t === 'image' ? defaults.image : null
    if (t === 'audio' && (!d?.text || d.text.toLowerCase().includes('document'))) {
      return DEFAULT_AUDIO_PROMPT
    }
    return d?.text ?? ''
  }

  function createFileItem(file: AttachedFile): FileItem {
    return {
      id: crypto.randomUUID(),
      kind: 'file',
      name: file.name,
      path: file.path,
      prompt: defaultPromptByType(file.type),
      size: file.size,
      fileCount: 1,
      file,
      mode: 'single',
    }
  }

  function createFolderItem(name: string, files: AttachedFile[]): FileItem {
    const firstType = files.find(f => f.type !== 'unknown')?.type ?? 'text'
    return {
      id: crypto.randomUUID(),
      kind: 'folder',
      name,
      path: name,
      prompt: defaultPromptByType(firstType),
      size: files.reduce((s, f) => s + f.size, 0),
      fileCount: files.length,
      files,
      mode: 'single',
    }
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    setLoading(true)
    setDropNotice(null)
    try {
      const browserFiles = Array.from(fileList)
      const supported = browserFiles.filter(isSupportedUpload)
      for (const browserFile of supported) {
        addFileItem(createFileItem(await fileToAttached(browserFile)))
      }
      const skipped = browserFiles.length - supported.length
      if (skipped > 0) setDropNotice(`Added ${supported.length} file${supported.length !== 1 ? 's' : ''}; skipped ${skipped} unsupported file${skipped !== 1 ? 's' : ''}.`)
    } catch (err) {
      console.error(err)
      setDropNotice('Could not attach one or more files.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectedFolder(fileList: FileList | null) {
    if (!fileList?.length) return
    setLoading(true)
    setDropNotice(null)
    try {
      const browserFiles = Array.from(fileList)
      const supported = browserFiles.filter(isSupportedUpload)
      const files = await Promise.all(supported.map(file => fileToAttached(file)))
      if (files.length === 0) {
        setDropNotice('No supported files found in that folder.')
        return
      }
      const firstPath = files[0]?.path ?? ''
      const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'Uploaded folder'
      addFileItem(createFolderItem(folderName, files))
      const skipped = browserFiles.length - supported.length
      if (skipped > 0) setDropNotice(`Added ${files.length} file${files.length !== 1 ? 's' : ''}; skipped ${skipped} unsupported file${skipped !== 1 ? 's' : ''}.`)
    } catch (err) {
      console.error(err)
      setDropNotice('Could not stage that folder.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingFiles(false)
    setLoading(true)
    setDropNotice(null)
    try {
      const dropped = await dataTransferToDroppedFiles(event.dataTransfer)
      let addedFiles = 0
      let skipped = 0

      const supportedLooseFiles = dropped.files.filter(isSupportedUpload)
      skipped += dropped.files.length - supportedLooseFiles.length
      for (const file of supportedLooseFiles) {
        addFileItem(createFileItem(await fileToAttached(file)))
        addedFiles += 1
      }

      for (const folder of dropped.folders) {
        const supported = folder.files.filter(({ file }) => isSupportedUpload(file))
        skipped += folder.files.length - supported.length
        const files = await Promise.all(supported.map(({ file, path }) => fileToAttached(file, path)))
        if (files.length > 0) {
          addFileItem(createFolderItem(folder.name, files))
          addedFiles += files.length
        }
      }

      if (dropped.unsupportedFolderDrop) {
        setDropNotice('This browser did not expose dropped folder contents. Use Stage Folder instead.')
      } else if (addedFiles === 0) {
        setDropNotice('No supported files found in the drop.')
      } else {
        setDropNotice(`Added ${addedFiles} file${addedFiles !== 1 ? 's' : ''}${skipped > 0 ? `; skipped ${skipped} unsupported file${skipped !== 1 ? 's' : ''}` : ''}.`)
      }
    } catch (err) {
      console.error(err)
      setDropNotice('Could not read the dropped files. Use Attach Files or Stage Folder instead.')
    } finally {
      setLoading(false)
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setIsDraggingFiles(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFiles(false)
    }
  }

  function iconForType(t: string) {
    switch (t) {
      case 'image': return <ImageIcon size={16} className="text-brand-gold" />
      case 'audio': return <FileAudio size={16} className="text-brand-blue dark:text-brand-gold" />
      case 'video': return <FileVideo size={16} className="text-brand-blue dark:text-brand-gold" />
      case 'text': return <FileTextIcon size={16} className="text-brand-blue dark:text-brand-gold" />
      default: return <FileIcon size={16} className="text-surface-400" />
    }
  }

  const previewFile = fileItems.flatMap(f => f.kind === 'folder' ? (f.files ?? []) : (f.file ? [f.file] : [])).find(f => f.path === previewPath)

  const enabledPrompts = customPrompts.filter((p: any) => p.enabled).length
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
        <label className="label">File Prompt Library <span className="text-surface-500 font-normal">(saved prompts with default flags)</span></label>
        <div className="card p-3 space-y-2">
          <select
            className="input text-xs w-full"
            value={fpEditorId ?? ''}
            onChange={e => {
              const id = e.target.value ? Number(e.target.value) : null
              setFpEditorId(id)
              const match = filePrompts.find(p => p.id === id)
              setFpEditorText(match?.text ?? '')
              setFpDefaultDoc(match?.is_default_document ?? false)
              setFpDefaultImg(match?.is_default_image ?? false)
              setFpDefaultAud(match?.is_default_audio ?? false)
            }}
          >
            <option value="">— New prompt —</option>
            {filePrompts.map(fp => (
              <option key={fp.id} value={fp.id}>{fp.text}</option>
            ))}
          </select>
          <div className="flex gap-2 items-start">
            <textarea
              className="input font-mono text-xs min-h-[60px] resize-y flex-1"
              placeholder="Type or edit a file prompt..."
              value={fpEditorText}
              onChange={e => setFpEditorText(e.target.value)}
            />
            <button
              onClick={async () => {
                const text = fpEditorText.trim()
                if (!text) return
                const body = {
                  ...(fpEditorId ? { id: fpEditorId } : {}),
                  text,
                  is_default_document: fpDefaultDoc,
                  is_default_image: fpDefaultImg,
                  is_default_audio: fpDefaultAud,
                }
                const method = fpEditorId ? 'PUT' : 'POST'
                const res = await fetch('/api/file-prompts', {
                  method,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                })
                if (res.ok) {
                  setFpSaveError(null)
                  loadFilePrompts()
                  const saved = await res.json()
                  setFpEditorId(saved.id)
                  setFpEditorText(saved.text)
                  setFpDefaultDoc(saved.is_default_document ?? false)
                  setFpDefaultImg(saved.is_default_image ?? false)
                  setFpDefaultAud(saved.is_default_audio ?? false)
                } else {
                  const err = await res.json().catch(() => ({ error: res.statusText }))
                  setFpSaveError(err.error ?? 'Save failed')
                }
              }}
              className="btn-primary text-xs whitespace-nowrap self-start"
            >
              Save
            </button>
          </div>
          <div className="flex gap-4 text-xs text-surface-400">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-surface-200">
              <input type="checkbox" checked={fpDefaultDoc} onChange={e => setFpDefaultDoc(e.target.checked)} className="accent-brand-gold" />
              Default for <span className="text-blue-400 font-medium">Document</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-surface-200">
              <input type="checkbox" checked={fpDefaultImg} onChange={e => setFpDefaultImg(e.target.checked)} className="accent-brand-gold" />
              Default for <span className="text-green-400 font-medium">Image</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-surface-200">
              <input type="checkbox" checked={fpDefaultAud} onChange={e => setFpDefaultAud(e.target.checked)} className="accent-brand-gold" />
              Default for <span className="text-purple-400 font-medium">Audio</span>
            </label>
          </div>
          {fpSaveError && (
            <div className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1">{fpSaveError}</div>
          )}
          <div className="text-xs space-y-1 pt-1 border-t border-surface-700">
            <span className="text-surface-500 font-medium">Current defaults:</span>
            {['document', 'image', 'audio'].map(type => {
              const d = defaults[type]
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className={`font-medium capitalize w-16 shrink-0 ${
                    type === 'document' ? 'text-blue-400' : type === 'audio' ? 'text-purple-400' : 'text-green-400'
                  }`}>{type}:</span>
                  <span className="text-surface-300 truncate flex-1">{d?.text ?? <span className="text-surface-500 italic">null</span>}</span>
                  {d && (
                    <button
                      onClick={() => {
                        setFpEditorId(d.id)
                        const match = filePrompts.find(p => p.id === d.id)
                        setFpEditorText(match?.text ?? '')
                        setFpDefaultDoc(match?.is_default_document ?? false)
                        setFpDefaultImg(match?.is_default_image ?? false)
                        setFpDefaultAud(match?.is_default_audio ?? false)
                      }}
                      className="text-surface-400 hover:text-surface-200"
                      title="Edit this default prompt"
                    >
                      <FileTextIcon size={12} />
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!d || !confirm(`Remove "${type}" default?`)) return
                      const res = await fetch('/api/file-prompts', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: d.id,
                          text: d.text,
                          is_default_document: type === 'document' ? false : filePrompts.find(p => p.id === d.id)?.is_default_document ?? false,
                          is_default_image: type === 'image' ? false : filePrompts.find(p => p.id === d.id)?.is_default_image ?? false,
                          is_default_audio: type === 'audio' ? false : filePrompts.find(p => p.id === d.id)?.is_default_audio ?? false,
                        }),
                      })
                      if (res.ok) loadFilePrompts()
                    }}
                    className="text-surface-400 hover:text-red-400"
                    title="Remove this default"
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
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
                  {p.enabled ? <ToggleRight size={18} className="text-brand-gold" /> : <ToggleLeft size={18} />}
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

      <div
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl border border-dashed transition-colors ${
          isDraggingFiles
            ? 'border-brand-gold bg-brand-gold/10'
            : 'border-transparent'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Files & Folders <span className="text-surface-400 font-normal text-xs">(attach a per-item prompt for each)</span></label>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => {
                handleSelectedFiles(e.currentTarget.files)
                e.currentTarget.value = ''
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={e => {
                handleSelectedFolder(e.currentTarget.files)
                e.currentTarget.value = ''
              }}
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-xs">
              <Paperclip size={14} /> Attach Files
            </button>
            <button onClick={() => folderInputRef.current?.click()} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-xs">
              <FolderOpen size={14} /> Stage Folder
            </button>
            {fileItems.length > 0 && (
              <button onClick={clearFileItems} className="btn-danger text-xs">Clear All</button>
            )}
          </div>
        </div>

        <div className={`mb-3 flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm transition-colors ${
          isDraggingFiles
            ? 'border-brand-gold bg-brand-gold/15 text-surface-100'
            : 'border-surface-700 bg-surface-900 text-surface-400'
        }`}>
          <UploadCloud size={18} className={isDraggingFiles ? 'text-brand-gold' : 'text-surface-500'} />
          <span>Drag files or folders here, or use the buttons above.</span>
        </div>

        {dropNotice && (
          <div className="mb-3 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-3 py-2 text-xs text-surface-200">
            {dropNotice}
          </div>
        )}

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
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${item.mode === 'batch' ? 'bg-brand-blue text-white dark:bg-brand-gold dark:text-brand-charcoal' : 'text-surface-400 hover:text-surface-200'}`}
                        >
                          Batch
                        </button>
                        <button
                          onClick={() => updateFileItem(item.id, { mode: 'single' })}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${item.mode === 'single' ? 'bg-brand-blue text-white dark:bg-brand-gold dark:text-brand-charcoal' : 'text-surface-400 hover:text-surface-200'}`}
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
                  <MessageSquare size={14} className={item.prompt ? 'text-brand-gold' : 'text-surface-500'} />
                  <select
                    className="input text-xs bg-surface-800 py-1 h-7 flex-1"
                    value={item.prompt ? filePrompts.find(fp => fp.text === item.prompt)?.id ?? '__custom__' : ''}
                    onChange={e => {
                      const v = e.target.value
                      if (!v) { updateFileItem(item.id, { prompt: '' }); return }
                      if (v === '__custom__') return
                      const match = filePrompts.find(fp => fp.id === Number(v))
                      updateFileItem(item.id, { prompt: match?.text ?? '' })
                    }}
                  >
                    <option value="">None</option>
                    {filePrompts.map(fp => (
                      <option key={fp.id} value={fp.id}>{fp.text}</option>
                    ))}
                    {item.prompt && !filePrompts.some(fp => fp.text === item.prompt) && (
                      <option value="__custom__" disabled>{item.prompt} (custom)</option>
                    )}
                  </select>
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
                          {f.enabled !== false ? <CheckSquare size={13} className="text-brand-gold" /> : <Square size={13} />}
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
