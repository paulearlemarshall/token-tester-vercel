# Token Tester Architecture

## Overview

Token Tester is an Electron desktop app for benchmarking LLM prompts, files, token usage, response latency, and estimated cost across multiple providers and models. The renderer builds provider/model test queues, the Electron main process performs privileged file and network work, and results are summarized in table and chart views.

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron 31 |
| UI | React 18 + TypeScript |
| Build tool | Vite 5 |
| Electron integration | vite-plugin-electron |
| Styling | Tailwind CSS 3 |
| Charts | Recharts 2 |
| State | Zustand |
| Tokenizer | gpt-tokenizer |
| Icons | Lucide React |

## Project Structure

```text
TokenTester/
|-- electron/
|   |-- main.ts              # App lifecycle, BrowserWindow, app-level IPC
|   |-- preload.ts           # Context bridge for renderer IPC calls
|   `-- ipc/
|       |-- api.ts           # Provider model discovery and chat calls
|       |-- files.ts         # File and directory selection/reading
|       |-- pricing.ts       # Built-in pricing lookup/write handlers
|       `-- tokenizer.ts     # Token counting IPC
|-- pricing/
|   `-- models.json          # Built-in provider/model pricing data
|-- src/
|   |-- App.tsx              # Root UI and startup pricing load
|   |-- store.ts             # Zustand state and localStorage persistence
|   |-- types.ts             # Shared renderer types
|   |-- components/
|   |   |-- ConfigureTab.tsx  # Provider configuration and model fetching
|   |   |-- PromptsTab.tsx    # System prompt, data prompts, files/folders
|   |   |-- RunTab.tsx        # Queue generation, execution, debug log
|   |   `-- ResultsTab.tsx    # Results summaries, charts, JSON/CSV export
|   `-- utils/
|       |-- constants.ts      # Provider presets
|       `-- formatters.ts     # Currency, duration, number helpers
|-- package.json
|-- vite.config.ts
|-- tailwind.config.js
`-- electron-builder.yml
```

## Runtime Flow

1. The renderer loads persisted provider, prompt, and pricing state from `localStorage`.
2. `App.tsx` loads built-in pricing through Electron IPC.
3. Users configure providers and models in `ConfigureTab.tsx`.
4. Users add prompts, individual files, or folders in `PromptsTab.tsx`.
5. `RunTab.tsx` creates a queue from enabled prompts/files and selected provider models.
6. Each queue item calls the main process through `api:chat`.
7. The main process resolves API keys from `.env`, calls the provider API, and normalizes usage data.
8. The renderer stores results, debug entries, latency, token counts, and optional pricing overrides.
9. `ResultsTab.tsx` shows totals, per-model charts, and JSON/CSV exports.

## IPC Surface

The preload exposes a constrained `window.electronAPI` bridge. The renderer does not receive direct Node.js or `process.env` access.

| Renderer API | Main handler | Purpose |
|---|---|---|
| `chatCompletion(params)` | `api:chat` | Send a prompt request to a configured provider/model. |
| `fetchModels(params)` | `api:fetchModels` | Fetch available models when the provider exposes model discovery. |
| `readFile(filePath)` | `file:read` | Read selected files into renderer-safe file entries. |
| `listDir(dirPath)` | `file:listDir` | List supported files in a directory. |
| `listDirRecursive(dirPath)` | `file:listDirRecursive` | Recursively list supported files. |
| `pickFiles()` | `file:pick` | Open a multi-file picker. |
| `pickDir()` / `pickDirectory()` | `file:pickDirectory` | Open a directory picker. |
| `countTokens(text)` | `tokenizer:count` | Count tokens with `gpt-tokenizer`. |
| `getPricing()` | `pricing:get` | Load built-in pricing from `pricing/models.json`. |
| `lookupPricing(model)` | `pricing:lookup` | Find the best matching built-in model price. |
| `readUserPricing()` | `pricing:readUser` | Load user pricing overrides from Electron user data. |
| `writeUserPricing(data)` | `pricing:writeUser` | Persist user pricing overrides to Electron user data. |

## Provider Support

OpenAI-compatible providers share `POST /v1/chat/completions` request and usage parsing. The app also includes Anthropic and Gemini-specific request builders.

| Provider family | Type | Notes |
|---|---|---|
| OpenAI, OpenRouter, DeepSeek, Mistral, Groq, Together, Perplexity, xAI, Fireworks, SS&C AI Gateway | `openai-compat` | Uses bearer auth and OpenAI-compatible chat completions. |
| Anthropic | `anthropic` | Uses `x-api-key` and `anthropic-version`; model discovery is intentionally disabled because Anthropic does not expose a models API endpoint. |
| Gemini | `gemini` | Uses Google Generative Language API with key query parameter. |

Provider responses are normalized to:

```ts
{
  inputTokens: number
  outputTokens: number
  totalTokens: number
  responseText: string
  latencyMs?: number
  error?: string
}
```

## File Handling

| File type | Current handling |
|---|---|
| Text/code files | Read as UTF-8 and injected into prompt content. |
| Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`) | Base64 encoded and sent as image content for multimodal providers. |
| PDF/DOCX | Attempted as UTF-8 text; no binary document parser is included. |
| Unknown files | Marked as unsupported/unknown and handled with placeholder content. |

Directory selection filters files to known text, image, PDF, and DOCX extensions. Folder file selection is all-or-nothing; per-file enable toggles were removed from the current UI state model.

## Pricing

Built-in pricing lives in `pricing/models.json` and is flattened by provider/model key for renderer use. User overrides are stored separately in Electron's `userData` directory as `user-pricing.json`. Rates are expressed as USD per 1M input and output tokens.

```ts
{
  input: number
  output: number
  per: "1M"
}
```

Cost calculation:

```text
cost = (inputTokens / 1_000_000) * inputRate
     + (outputTokens / 1_000_000) * outputRate
```

The lookup path uses exact keys first, then short model names, then longest-prefix matching.

## State Management

Zustand stores app state in `src/store.ts`.

Persisted to `localStorage`:

- Provider configuration.
- System prompt.
- Custom data prompts.
- User model pricing overrides.

Transient:

- Attached files and folder entries.
- Generated run queue.
- Run progress and status.
- Debug log entries in `RunTab.tsx`.
- Active running state.

## Results

`ResultsTab.tsx` summarizes completed runs with:

- Success/error counts.
- Total input, output, and combined tokens.
- Estimated total cost.
- Average latency.
- Per-model cost and token charts.
- JSON and CSV exports.

## Development

```bash
npm run dev
npm run dev:safe
npm run build
npm run dist
```

API keys belong in `.env`, which is ignored by Git. `.env.example` documents the expected variable names.

Use `npm run dev:safe` or `scripts\dev.cmd` on Windows if PowerShell reports duplicate `Path`/`PATH` environment variables while starting background processes.

## Known Limitations

- PDF and DOCX parsing is plain text only.
- Local token counts use `cl100k_base`, so provider-reported token counts may differ.
- Requests are non-streaming.
- Retry/backoff for provider rate limits is not implemented.
- Pricing data is local and can become stale.
