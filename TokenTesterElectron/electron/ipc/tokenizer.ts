import { ipcMain } from 'electron'
import { encode } from 'gpt-tokenizer'

export function registerTokenizerHandlers() {
  ipcMain.handle('tokenizer:count', async (_event, text: string) => {
    try {
      const tokens = encode(text)
      return tokens.length
    } catch {
      return text.length
    }
  })
}
