import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpcHandlers } from './ipc/api'
import { registerFileHandlers } from './ipc/files'
import { registerTokenizerHandlers } from './ipc/tokenizer'
import { registerPricingHandlers } from './ipc/pricing'

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(__dirname, '../.env'),
  ]

  for (const envPath of candidates) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        process.env[key] = val
      }
      return
    } catch {
      continue
    }
  }

  console.warn('No .env file found in any known location')
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Token Tester',
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  loadEnv()

  ipcMain.handle('file:openEnv', async () => {
    const envPath = [
      path.join(process.cwd(), '.env'),
      path.join(app.getAppPath(), '.env'),
      path.join(__dirname, '../.env'),
    ].find(p => fs.existsSync(p)) ?? path.join(process.cwd(), '.env')
    try { await shell.openPath(envPath) } catch { /* ignore */ }
  })

  registerIpcHandlers()
  registerFileHandlers()
  registerTokenizerHandlers()
  registerPricingHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
