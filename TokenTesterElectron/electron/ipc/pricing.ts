import { app, ipcMain, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'

const PRICING_PATH = path.join(__dirname, '../pricing/models.json')

function userPricingPath() {
  return path.join(app.getPath('userData'), 'user-pricing.json')
}

function flatten(nested: Record<string, Record<string, any>>): Record<string, any> {
  const flat: Record<string, any> = {}
  for (const [provider, models] of Object.entries(nested)) {
    for (const [model, pricing] of Object.entries(models)) {
      flat[`${provider}/${model}`] = pricing
    }
  }
  return flat
}

export function registerPricingHandlers() {
  ipcMain.handle('pricing:get', async () => {
    try {
      const raw = await fs.readFile(PRICING_PATH, 'utf-8')
      return flatten(JSON.parse(raw))
    } catch {
      return {}
    }
  })

  ipcMain.handle('pricing:lookup', async (_event, model: string) => {
    try {
      const raw = await fs.readFile(PRICING_PATH, 'utf-8')
      const nested = JSON.parse(raw)
      const pricing = flatten(nested)

      if (pricing[model]) return pricing[model]

      const short = model.includes('/') ? model.split('/').pop()! : model
      if (short !== model && pricing[short]) return pricing[short]

      const sorted = Object.keys(pricing).sort((a, b) => b.length - a.length)
      for (const key of sorted) {
        if (model.startsWith(key)) return pricing[key]
        if (model.endsWith(`/${key}`)) return pricing[key]
      }

      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('pricing:write', async (_event, data: Record<string, { input: number; output: number }>) => {
    try {
      const nested: Record<string, any> = {}
      for (const [key, val] of Object.entries(data)) {
        const idx = key.indexOf('/')
        if (idx === -1) continue
        const provider = key.slice(0, idx)
        const model = key.slice(idx + 1)
        if (!nested[provider]) nested[provider] = {}
        nested[provider][model] = { ...val, per: '1M' }
      }
      await fs.writeFile(PRICING_PATH, JSON.stringify(nested, null, 2) + '\n', 'utf-8')
      return true
    } catch (err) {
      console.error('Failed to write pricing:', err)
      return false
    }
  })

  ipcMain.handle('pricing:readUser', async () => {
    try {
      const raw = await fs.readFile(userPricingPath(), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  })

  ipcMain.handle('pricing:writeUser', async (_event, data: Record<string, { input: number; output: number }>) => {
    try {
      await fs.mkdir(path.dirname(userPricingPath()), { recursive: true })
      await fs.writeFile(userPricingPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8')
      return true
    } catch (err) {
      console.error('Failed to write user pricing:', err)
      return false
    }
  })

  ipcMain.handle('file:openPricingFile', async () => {
    try {
      const filePath = userPricingPath()
      try {
        await fs.access(filePath)
      } catch {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, '{}\n', 'utf-8')
      }
      await shell.openPath(filePath)
    } catch { /* ignore */ }
  })
}
