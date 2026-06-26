# Token Tester Web

Token Tester Web is the Vercel-only Next.js app for comparing AI model behavior across providers. It runs prompt and file tests, records response text, token usage, latency, estimated cost, provider request details, and keeps a searchable Results Archive in Neon Postgres or local `.local-data/` storage when `DATABASE_URL` is not configured.

Production app:

```text
https://token-tester-web.vercel.app
```

## Repository Layout

The deployable app lives in:

```text
TokenTesterWeb/
```

Vercel must use `TokenTesterWeb` as the project Root Directory.

## What The App Does

- Configures multiple AI providers without exposing provider API keys to the browser.
- Discovers provider models and imports live provider pricing when available.
- Seeds pricing from `simonw/llm-prices` and allows manual or provider-discovered overrides.
- Runs prompt, file, image, PDF, DOCX, single-file, and batch-file tests across selected models.
- Preserves completed queue results when more models are added.
- Archives every completed observation with hashes, timestamps, payloads, tokens, latency, price, and output.
- Provides a Results Archive with filters, grouped views, charts, suppression, deletion, column sorting, column reordering, and XLS export.
- Categorizes archived documents with OpenAI when configured, with heuristic fallback.
- Provides Model Stats grouped by provider, model, document type, and category.
- Shows provider-specific handling rules so users can see how each provider receives files, prompts, images, PDFs, and API parameters.

## Quick Start

```powershell
cd TokenTesterWeb
npm install
vercel link
vercel env pull .env.local
npm run db:setup
npm run dev
```

For local-only testing without Neon, leave `DATABASE_URL` blank; the app writes JSON files under `TokenTesterWeb/.local-data/`.

Open:

```text
http://localhost:3000
```

## Checks And Deployment

```powershell
cd TokenTesterWeb
npm run lint
npm run build
vercel deploy --prod --yes
```

## Documentation

The full feature, architecture, database, provider, pricing, archive, and deployment guide is in:

[TokenTesterWeb/README.md](TokenTesterWeb/README.md)
