# Token Tester Web

Token Tester Web is the Vercel-deployed Next.js App Router app for comparing model responses, token usage, latency, and estimated cost across multiple AI providers while keeping provider API keys on the server.

## Runtime

- Framework: Next.js `16.2.9` with React `19.2.4`.
- Styling: Tailwind CSS `4` through `src/app/globals.css`.
- State: Zustand store in `src/store.ts`, persisted to browser `localStorage`.
- Token counting: `gpt-tokenizer` for local estimates.
- Charts and tables: Recharts and local React components.
- Database: Neon Postgres through `@neondatabase/serverless`.
- Deployment target: Vercel production project `token-tester-web`.

## Code Map

- `src/app/page.tsx`: renders the client app shell.
- `src/app/layout.tsx`: global metadata and layout.
- `src/components/TokenTesterApp.tsx`: top-level tabbed interface.
- `src/components/ConfigureTab.tsx`: provider setup, model discovery, fetched pricing import.
- `src/components/PromptsTab.tsx`: prompt and file input management.
- `src/components/RunTab.tsx`: model selection, cost fields, execution queue, unsupported attachment skips, retry actions, and per-model price edits.
- `src/components/ResultsTab.tsx`: run results, summaries, charts, and exports.
- `src/components/layout/Sidebar.tsx`: primary navigation.
- `src/lib/provider-api.ts`: server-side provider model discovery and chat completion adapters.
- `src/lib/pricing.ts`: Neon pricing read/write logic.
- `src/lib/provider-key.ts`: canonical provider identity and pricing lookup helpers.
- `src/lib/provider-capabilities.ts`: attachment capability and provider-specific file policy helpers.
- `src/lib/db.ts`: Neon SQL client.
- `src/lib/web-api.ts`: browser-side wrappers for app API routes.
- `src/lib/browser-files.ts`: browser file parsing helpers.
- `src/utils/constants.ts`: provider presets and labels.
- `src/utils/formatters.ts`: display formatting helpers.
- `src/types.ts`: shared app and API types.
- `scripts/setup-pricing-db.mjs`: creates the Neon `model_prices` table and indexes.
- `scripts/seed-pricing.mjs`: imports pricing JSON or NDJSON into Neon.

## API Routes

- `POST /api/models`: calls provider model discovery using server-side env vars. OpenAI-compatible providers call `{baseUrl}/v1/models`; Gemini and Anthropic use provider-specific routes.
- `POST /api/chat`: calls provider chat/completion APIs using server-side env vars. OpenAI-compatible providers call `{baseUrl}/v1/chat/completions`.
- `GET /api/pricing`: reads model prices from Neon only.
- `PUT /api/pricing`: upserts one model price into Neon.

Provider secrets are never exposed to the browser. The browser sends the provider type, base URL, model, and env var name; the route handler reads the actual secret from Vercel or local `.env.local`.

## Providers

Built-in presets are defined in `src/utils/constants.ts`.

- OpenAI: `OPENAI_API_KEY`, OpenAI-compatible.
- OpenRouter: `OPENROUTER_API_KEY`, OpenAI-compatible.
- SS&C AI Gateway: `SSC_CLOUD_API_KEY`, OpenAI-compatible with optional `OpenAI-Project` header.
- Anthropic: `ANTHROPIC_API_KEY`, Anthropic Messages API.
- Google Gemini: `GEMINI_API_KEY`, Google Generative Language API.
- DeepSeek: `DEEPSEEK_API_KEY`, OpenAI-compatible.
- Mistral: `MISTRAL_API_KEY`, OpenAI-compatible.
- xAI: `XAI_API_KEY`, OpenAI-compatible at `https://api.x.ai`.

Saved browser configs that still reference the old Groq preset are migrated in `src/store.ts` to xAI with `XAI_API_KEY`.

## File and Document Handling

Uploads are parsed in `src/lib/browser-files.ts` and queued in `src/components/RunTab.tsx`.

- Text files are sent as text message parts.
- Images are sent as image parts when the provider capability helper says the provider supports them.
- PDFs and DOCX files are classified as `document` attachments and are only sent to providers that the app explicitly treats as document-capable.
- Unsupported attachments are marked `skipped` before inference. Skipped runs record zero input tokens, zero output tokens, zero latency, and zero cost.
- If a provider rejects a file, image, or document payload, the run is marked `skipped`; the app must not retry with a placeholder such as `[.PDF file]`, because that encourages hallucinated answers.
- DeepSeek providers and DeepSeek-routed models are treated as text-only and skip PDFs, DOCX files, and images.
- Generic OpenAI-compatible providers are conservative by default. OpenAI's own API is treated as document-capable; other OpenAI-compatible gateways should be explicitly allowed only after their request schema is verified.
- Queue rows with `error` status can be retried individually. Queue rows with `skipped` status are informational and are not retried, because the input is known to be unsupported.

## Pricing

The deployed app uses Neon as the pricing source of truth. Static model-pricing bundles are not used at runtime.

Neon keeps a legacy/effective table plus a source-record table:

```sql
model_prices (
  service_provider text not null,
  model_id text not null,
  upstream_provider text,
  display_name text,
  input_per_1m numeric(12, 6) not null,
  output_per_1m numeric(12, 6) not null,
  currency text not null default 'USD',
  source text not null default 'manual',
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_provider, model_id)
)

model_price_records (
  service_provider text not null,
  model_id text not null,
  source text not null,
  source_priority integer not null,
  raw_source_payload jsonb,
  raw_provider_payload jsonb,
  match_status text,
  match_confidence numeric(5, 4),
  match_method text,
  match_evidence jsonb,
  unique (service_provider, model_id, source)
)
```

Prices are stored as USD per 1 million tokens. `GET /api/pricing` returns the effective flattened map by selecting the highest-priority source record per provider/model. `GET /api/pricing/records` returns all seed/live/manual records for the Pricing navigator. Source priority is:

- Provider discovery: `100`.
- Manual edits: `50`.
- `llm-prices` seed rows: `10`.

Manual edits in the Run tab call `PUT /api/pricing` and persist to Neon. Model discovery can also populate pricing when the provider returns machine-readable prices:

- OpenRouter-style `pricing.prompt` and `pricing.completion` are converted from per-token USD to USD per 1M tokens.
- xAI `prompt_text_token_price` and `completion_text_token_price` are converted from USD cents per 100M tokens to USD per 1M tokens by dividing by `10000`.
- Provider discovery stores the raw provider model payload and matching evidence so the navigator can explain why a price applies.
- The Configure tab `Pricing` button opens the provider/model navigator for effective prices, source precedence, raw context, and match evidence.
- Gemini pricing is canonicalized under `google/*`, so direct Gemini model cards like `gemini-2.5-flash` resolve against `google/gemini-2.5-flash`.
- Provider-discovery rows override seeded `llm-prices` rows when both exist for the same canonical provider/model.
- The Pricing navigator table is sortable by provider, model, input, output, winner, record count, and updated time, in both directions.

## Environment Variables

Required for pricing:

```env
DATABASE_URL=
```

Provider keys:

```env
OPENAI_API_KEY=
OPENROUTER_API_KEY=
SSC_CLOUD_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
MISTRAL_API_KEY=
XAI_API_KEY=
```

On Vercel, `DATABASE_URL` and related Neon variables are provisioned for Production, Preview, and Development. `XAI_API_KEY` is currently configured for Production; add it to Preview and Development if those environments need xAI calls.

## Local Development

```powershell
cd TokenTesterWeb
npm install
vercel link
vercel env pull .env.local
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

## Database Setup and Imports

Create or repair the schema:

```powershell
npm run db:setup
```

Import a JSON or NDJSON pricing file:

```powershell
npm run db:import-pricing -- path\to\model-prices.json
```

Seed current direct-vendor prices from `simonw/llm-prices`:

```powershell
npm run db:import-pricing -- llm-prices
```

Supported JSON shapes:

- Array rows: `{ "provider": "openrouter", "model": "openai/gpt-4o", "input": 2.5, "output": 10 }`.
- Nested map: `{ "openrouter": { "openai/gpt-4o": { "input": 2.5, "output": 10, "per": "1M" } } }`.
- `llm-prices` current API shape: `{ "updated_at": "2026-06-09", "prices": [{ "vendor": "openai", "id": "gpt-4o", "name": "GPT-4o", "input": 2.5, "output": 10, "input_cached": 1.25 }] }`.

Current matching rules to keep in mind:

- Pricing lookup always prefers a canonical provider key first, then a legacy provider-name alias if present.
- Gemini provider names and the Gemini provider type map to `google` for pricing and navigator records.
- The Run tab still uses provider-specific adapters for message formatting, but attachment support is now defined in `src/lib/provider-capabilities.ts` instead of being hard-coded inline in one place.

## Verification

Before deploying:

```powershell
npm run lint
npm run build
```

Known current lint state: the project builds successfully, and lint reports existing warnings in UI components for `next/image`, unused locals, and hook dependency warnings.

Useful production smoke tests:

```powershell
node -e "fetch('https://token-tester-web.vercel.app/api/pricing').then(r=>console.log(r.status))"
```

```powershell
@'
(async () => {
  const res = await fetch('https://token-tester-web.vercel.app/api/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'openai-compat', baseUrl: 'https://api.x.ai', apiKeyEnv: 'XAI_API_KEY' })
  })
  console.log(res.status, await res.text())
})()
'@ | node
```

## Vercel Deployment

Production deploy:

```powershell
cd TokenTesterWeb
vercel deploy --prod --yes
```

Inspect production:

```powershell
vercel inspect token-tester-web.vercel.app
vercel logs https://token-tester-web.vercel.app --level error --since 30m
vercel env ls
```

The production alias is:

```text
https://token-tester-web.vercel.app
```

## Git Workflow

Run checks, commit the scoped change, push `main`, then deploy production:

```powershell
git status --short
npm run lint
npm run build
git add <changed-files>
git commit -m "<message>"
git push
vercel deploy --prod --yes
```
