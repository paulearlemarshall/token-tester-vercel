import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  chatCompletion: (params: any) => ipcRenderer.invoke('api:chat', params),
  fetchModels: (params: any) => ipcRenderer.invoke('api:fetchModels', params),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  listDir: (dirPath: string) => ipcRenderer.invoke('file:listDir', dirPath),
  listDirRecursive: (dirPath: string) => ipcRenderer.invoke('file:listDirRecursive', dirPath),
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  pickDir: () => ipcRenderer.invoke('file:pickDirectory'),
  pickDirectory: () => ipcRenderer.invoke('file:pickDirectory'),
  openEnv: () => ipcRenderer.invoke('file:openEnv'),
  openPricingFile: () => ipcRenderer.invoke('file:openPricingFile'),
  countTokens: (text: string) => ipcRenderer.invoke('tokenizer:count', text),
  getPricing: () => ipcRenderer.invoke('pricing:get'),
  lookupPricing: (model: string) => ipcRenderer.invoke('pricing:lookup', model),
  readUserPricing: () => ipcRenderer.invoke('pricing:readUser'),
  writeUserPricing: (data: Record<string, { input: number; output: number }>) => ipcRenderer.invoke('pricing:writeUser', data),
})
