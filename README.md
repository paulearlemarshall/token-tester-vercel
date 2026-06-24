# Token Tester Web

Token Tester Web is the Vercel-deployed Next.js app for comparing model responses, token usage, latency, and estimated cost across multiple AI providers while keeping provider API keys on the server.

Production app:

```text
https://token-tester-web.vercel.app
```

## What It Does

- Configures multiple providers and discovers their models.
- Runs prompt and file-based tests across selected models.
- Measures latency, token counts, and estimated cost.
- Stores pricing in Neon Postgres with manual, seeded, and provider-discovered overrides.
- Skips unsupported attachments instead of forcing placeholder retries.
- Surfaces raw pricing records, precedence, and evidence in a navigator UI.
- Uses provider adapters so the browser sends normalized runs while the server builds provider-specific wire payloads.

## Core Workflow

```powershell
cd TokenTesterWeb
npm install
npm run lint
npm run build
vercel deploy --prod --yes
```

## Key Notes

- The deployable Next.js app lives in `TokenTesterWeb`; Vercel Git builds must use `TokenTesterWeb` as the project Root Directory.
- Provider behavior is selected by adapter ID, not only by the broad `openai-compat`, `anthropic`, or `gemini` protocol type.
- Gemini pricing is canonicalized under `google/*`.
- Manual model price edits and provider-discovered prices persist to Neon.
- DeepSeek and DeepSeek-routed models are treated as text-only.
- Unsupported binary attachments are skipped before inference and count as zero tokens/cost.
- OpenRouter PDFs are handled through OpenRouter's universal PDF parsing path.
- xAI / Grok requests use the Responses API path in the web app.
- The Pricing navigator is sortable and shows effective values plus underlying records.

## Documentation

- [TokenTesterWeb/README.md](TokenTesterWeb/README.md) covers architecture, pricing, providers, file handling, database setup, and deployment in detail.
