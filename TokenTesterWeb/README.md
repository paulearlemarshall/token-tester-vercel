# Token Tester Web

Token Tester Web is a Vercel-deployed Next.js App Router application for testing AI providers side by side. It compares response quality, token usage, latency, file handling, pricing, and estimated cost across model/provider combinations, then stores completed observations in a persistent Neon-backed Results Archive.

Production:

```text
https://token-tester-web.vercel.app
```

## Core Capabilities

- Configure AI providers while keeping API keys on the server.
- Discover provider models through server-side API routes.
- Import provider-discovered pricing when providers expose machine-readable prices.
- Seed baseline pricing from `simonw/llm-prices`.
- Override model prices manually from the UI.
- Queue prompt, file, folder, single-file, and batch-file tests across many providers and models.
- Save, load, overwrite, and delete DB-backed model presets for repeat provider/model working sets.
- Show the active selected model set with provider, model, input price, output price, and missing-model warnings.
- Preserve completed queue rows when adding more models.
- Skip unsupported file/provider combinations without retrying fake placeholder content.
- Run text, image, PDF, DOCX, audio, video, and batch-file workloads where provider adapters support them.
- Default audio-only file runs use a speech-to-text prompt unless the user supplies a custom prompt.
- Track local token estimates, provider token usage, latency, output text, errors, and estimated cost.
- Persist every completed run to Neon with checksums, timestamps, provider metadata, payloads, and pricing context.
- Slice archived observations by provider, model, status, source, file, prompt, checksum, suppression state, and date.
- Export archive data to XLS.
- Inspect provider-specific request handling from the Models tab.

## Runtime Stack

- Framework: Next.js `16.2.9`, App Router.
- UI: React `19.2.4`.
- Styling: Tailwind CSS `4`.
- State: Zustand, persisted to browser `localStorage`.
- Database: Neon Postgres through `@neondatabase/serverless`.
- Token estimation: `gpt-tokenizer`.
- Charts: Recharts.
- Spreadsheet export: `xlsx`.
- Deployment: Vercel project `token-tester-web`.

## App Structure

```text
src/app/page.tsx                         App shell entry
src/app/layout.tsx                       Global metadata/layout
src/components/TokenTesterApp.tsx        Main tabbed interface
src/components/ConfigureTab.tsx          Provider setup, model fetch, pricing entry point
src/components/PromptsTab.tsx            Prompt and file input management
src/components/ModelsTab.tsx             Model presets, provider model selection, selected model summary
src/components/RunTab.tsx                Queue generation, execution, retries, output inspection
src/components/ResultsTab.tsx            Current in-memory run results, charts, exports
src/components/ResultsArchiveTab.tsx     Persisted archive filters, tables, charts, XLS export
src/components/PricingNavigator.tsx      Pricing records, effective prices, evidence
src/components/layout/Sidebar.tsx        Left navigation
src/lib/provider-api.ts                  Server-side provider discovery and request adapters
src/lib/provider-registry.ts             Provider adapter IDs, canonical keys, attachment capabilities
src/lib/run-input.ts                     Normalized prompt/file input building
src/lib/browser-files.ts                 Browser-side file parsing
src/lib/pricing.ts                       Neon pricing reads/writes
src/lib/pricing-match.ts                 Canonical pricing lookup and fallback matching
src/lib/run-results.ts                   Neon Results Archive schema and persistence
src/lib/web-api.ts                       Browser wrappers for app API routes
src/types.ts                             Shared TypeScript types
scripts/setup-pricing-db.mjs             Database setup and schema repair
scripts/seed-pricing.mjs                 Pricing importer
```

## Main Workflow

1. Configure provider connections.
2. Fetch models from providers.
3. Review or adjust pricing in the Pricing navigator.
4. Create or select prompts and upload test files.
5. Select models or load a model preset on the Models tab.
6. Generate the queue.
7. Run all queued work or retry individual failed rows.
8. Review current run output in Results.
9. Review persisted history in Results Archive.

## Navigation Tabs

### Configure

The Configure tab manages provider definitions and model discovery.

It supports:

- Built-in provider presets.
- Custom OpenAI-compatible providers.
- Server-side model fetching through `POST /api/models`.
- Bulk model fetching for every enabled provider through the Update Models button.
- Provider API keys stored in Vercel/local environment variables, not browser state.
- Importing provider-discovered prices into Neon.
- Opening the Pricing navigator.

Provider definitions include:

- Display name.
- Provider type.
- Adapter ID.
- Base URL.
- API key environment variable name.
- Optional project/header metadata.

### Prompts And Files

The Prompts tab manages test inputs.

It supports:

- System prompt text.
- User/custom prompt text.
- File uploads.
- Folder-style batches where browser file metadata is available.
- Text extraction for supported text-like files.
- Base64 capture for binary files.
- Image, PDF, DOCX, audio, video, text, and mixed batch inputs.

The browser computes deterministic input identity before archiving so repeat observations can be grouped later.

### Models

The Models tab manages the model working set used by queue generation.

It supports:

- DB-backed model presets, with save-by-name overwrite and delete.
- Provider/model search and selection.
- Provider model sorting by active state, name, input price, and output price.
- Provider modality filters where provider discovery exposes modality metadata.
- Per-model price editing.
- A sortable selected-models table showing provider, model, input price, and output price.
- Missing preset models remaining visible and highlighted when they are not in the current provider model list.
- Provider/model Handling inspector.

### Run Tests

The Run Tests tab generates work, runs jobs, and shows queue/output execution detail.

It supports:

- Queue generation across selected providers, models, prompts, and files.
- Incremental queue generation.
- Run-all for queued work only.
- Individual retry for error rows.
- Clear queue reset.
- Skipped rows for unsupported attachments.
- Debug payload inspection.
- Provider/model Handling inspector.

Queue semantics:

- `Generate Queue` adds missing jobs only.
- Existing `success`, `error`, `skipped`, and `queued` rows are preserved.
- Adding more models and generating the queue appends only the new missing jobs.
- `Run All` executes rows still marked `queued`.
- Completed work is not re-run unless retried explicitly.
- `Clear` starts again from an empty queue.

### Results

The Results tab shows the current browser session results from the active queue.

It supports:

- Current run table.
- Success/error/skipped summary.
- Token and cost summaries.
- Latency comparison.
- Response text inspection.
- Export of current in-memory results.

The Results tab is for the active working set. The Results Archive is the persisted historical database.

### Results Archive

The Results Archive tab is the persistent analysis surface for completed observations stored in Neon.

It supports:

- Latest-per-checksum mode.
- All-observations history mode.
- Records table view.
- Group by file.
- Group by prompt.
- Provider filter.
- Model filter.
- Status filter.
- Source type filter.
- File filter.
- Suppression visibility filter.
- Free-text search across provider, model, source, file name, path, hashes, response text, and errors.
- Reset filters.
- Sortable data columns.
- Drag-reorderable data columns.
- Suppressed column with sorting.
- Multi-select.
- Suppress selected.
- Restore selected.
- Confirmed permanent delete.
- XLS export.
- Charts and summary metrics.

Suppression behavior:

- Suppressed rows remain visible when visibility is `All` or `Suppressed`.
- Suppressed rows are greyed out.
- Suppressed rows do not count in stats, charts, grouped summaries, or aggregate metrics.
- Suppression is reversible.
- Delete is permanent and requires confirmation.

Archive XLS export includes the filtered/sorted rows and preserves the stored data fields, including IDs, hashes, prompt text, file metadata, media payload flags and sizes, token counts, latency, pricing, output text, errors, request payload, response payload, timestamps, and suppression state.

## Provider Support

Built-in providers:

| Provider | Adapter ID | API key env | Notes |
| --- | --- | --- | --- |
| OpenAI | `openai` | `OPENAI_API_KEY` | Text/image/doc: Responses API (/v1/responses). Audio (chat models): /v1/chat/completions with input_audio. Audio (transcription models): /v1/audio/transcriptions multipart upload. |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | OpenAI-compatible API plus OpenRouter model metadata, universal PDF handling, and OpenRouter-specific audio payloads. |
| SS&C AI Gateway | `ssnc-ai-gateway` | `SSC_CLOUD_API_KEY` | OpenAI-compatible gateway with optional project header. |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | Uses Anthropic Messages API. |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | Uses Google Generative Language `generateContent`. |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | Treated as text-only. |
| Mistral | `mistral` | `MISTRAL_API_KEY` | OpenAI-compatible chat completions. |
| xAI | `xai` | `XAI_API_KEY` | Uses xAI Responses API for runs, including document input; audio files are transcribed through xAI STT first. |
| Custom OpenAI-compatible | `custom-openai-compatible` | user-defined | Conservative capabilities until verified. |

Provider behavior is controlled by adapter ID, not only the broad protocol family. This matters because OpenAI-compatible providers can differ materially in file support, pricing metadata, headers, payload fields, and model-specific restrictions.

## Provider Handling Inspector

Each provider on the Models tab has a `Handling` button. It opens a provider/model navigator that explains what the app will do under the hood.

The inspector shows:

- Provider adapter.
- Broad protocol type.
- Canonical pricing key.
- Base URL.
- API key environment variable.
- Request endpoint.
- Request payload shape.
- Extra headers.
- Attachment handling rules.
- Image support.
- Document support.
- Text-file behavior.
- Model-specific restrictions.
- Input and output modality filters when provider metadata exposes them.
- Skip behavior.
- Selected models for that provider.

Examples:

- xAI runs use `/v1/responses`, upload PDFs/documents to `/v1/files`, and reference them as `input_file`.
- xAI audio attachments are sent to `/v1/stt` as multipart uploads, then the transcript is passed into the Responses API run.
- Anthropic runs use `/v1/messages`, `anthropic-version`, `system`, and `messages`.
- Gemini runs use `generateContent`, `contents`, and `generationConfig.maxOutputTokens`.
- Gemini can send image, document, audio, and video attachments through `inlineData`.
- OpenAI-native runs have three routing branches:
  - **Text/image/doc**: `/v1/responses` (Responses API), `{ model, input, instructions?, max_output_tokens }`.
  - **Audio on chat models** (gpt-audio-*): `/v1/chat/completions`, `{ model, messages, max_tokens }`, with `input_audio: { data, format }`. No file-name labels in text — media is sent natively.
  - **Audio on transcription models** (whisper-*, gpt-4o-transcribe-*): `/v1/audio/transcriptions` as multipart form upload.
- Other OpenAI-compatible adapters (openrouter, deepseek, mistral) still use `/v1/chat/completions`, `messages`, and either `max_tokens` or `max_completion_tokens` for reasoning-style models.
- OpenRouter is treated as PDF-capable through its universal PDF path, while image and audio support are model-dependent.
- OpenRouter audio attachments use `input_audio` with `inputAudio: { data, format }`.
- OpenRouter transcription-output models use `/v1/audio/transcriptions` for audio-only runs.
- DeepSeek-routed models are treated as text-only.

## File And Attachment Handling

Uploads are parsed in the browser, normalized into neutral run input, then serialized by the server adapter.

Attachment kinds:

- `text`: embedded into the prompt with filename delimiters or provider text blocks.
- `image`: sent as provider-supported image content.
- `document`: sent only when the provider adapter supports documents.
- `audio`: sent only when the provider adapter supports audio.
- `video`: sent only when the provider adapter supports video.

Provider behavior:

- Audio-only default prompts ask the model to perform speech-to-text; custom per-file prompts override this.
- OpenRouter PDFs use OpenRouter's universal PDF handling path.
- OpenAI audio files use Chat Completions `input_audio` parts with base64 data and inferred audio format.
- OpenRouter audio files use OpenRouter's `inputAudio` variant with base64 data and inferred audio format.
- OpenRouter audio-only runs with transcription-output models use the dedicated transcriptions endpoint and return the transcript text directly.
- xAI PDFs use the Responses API, with file upload and `input_file` references.
- xAI images use `input_image`.
- xAI audio files use the REST `/v1/stt` transcription endpoint before the transcript is appended to the response prompt.
- Anthropic images/documents use base64 source blocks.
- Gemini binary files use `inlineData`.
- Gemini audio and video files use `inlineData` with the browser-provided MIME type.
- DeepSeek and DeepSeek-routed models skip non-text attachments.
- Generic OpenAI-compatible providers are conservative unless the app has explicit rules.

Unsupported attachments:

- Are marked `skipped`.
- Are archived as skipped observations.
- Use zero tokens, zero latency, and zero estimated cost.
- Are not retried with placeholder text.

Provider rejections:

- File/image/document rejection is treated as skipped when it indicates unsupported content.
- Other provider failures are recorded as errors and can be retried.

## Pricing System

Pricing is stored in Neon. Runtime pricing does not depend on a static bundled JSON file.

Sources:

- Provider discovery: priority `100`.
- Manual UI override: priority `50`.
- `llm-prices` seed: priority `10`.

Rates are stored as USD per 1 million tokens.

Effective pricing selects the highest-priority record for the canonical provider/model pair.

Canonical pricing behavior:

- Gemini pricing is stored under `google`.
- Gemini card names such as `gemini-2.5-flash` resolve against `google/gemini-2.5-flash`.
- OpenRouter models preserve routed model IDs.
- OpenRouter model discovery captures `architecture.input_modalities` and `architecture.output_modalities` and fetches non-text output models for filtering.
- Provider discovery stores raw provider payloads and match evidence.
- Manual edits remain visible as manual source records.

Provider-discovered conversions:

- OpenRouter `pricing.prompt` and `pricing.completion` values are converted from per-token USD to USD per 1M tokens.
- xAI `prompt_text_token_price` and `completion_text_token_price` values are converted from cents per 100M tokens to USD per 1M tokens.

## Pricing Navigator

The Pricing navigator is opened from Configure.

It supports:

- Provider/model browsing.
- Effective input and output price columns.
- Source record counts.
- Winning source display.
- Sorting in both directions.
- Per-source price deletion with confirmation.
- Expanded raw source records.
- Match confidence.
- Match method.
- Match evidence.
- Raw source payload.
- Raw provider payload.
- Last-seen and updated timestamps.

This lets the user verify why a price is being applied to a model card.

Deleting a price removes that source record from Neon and recomputes the effective price for the same provider/model. If another source record exists, the model falls back to the next highest-priority source. If no source records remain, the effective price is removed until provider discovery, `llm-prices` import, imported JSON, or a manual override recreates it.

## Results Archive Data Model

Every completed observation is archived. Runs are append-only observations, while `record_key` groups equivalent work.

Identity fields:

- `run_id`: unique per completed observation.
- `record_key`: canonical provider, model, and input checksum.
- `input_hash`: checksum for the effective input.
- `system_prompt_hash`: checksum of system prompt text.
- `user_message_hash`: checksum of custom/user prompt text.
- `file_hash`: checksum of a single file where available.
- `batch_files`: JSON metadata and hashes for batch inputs.
- `pdf_sent`, `image_sent`, `video_sent`, `audio_sent`: whether that media category was actually included in the provider payload.
- `pdf_file_size`, `image_file_size`, `video_file_size`, `audio_file_size`: aggregate sent file size in bytes for that media category.

Stored execution fields:

- Provider ID.
- Provider display name.
- Canonical service provider.
- Model.
- Source type.
- Source label.
- Status.
- PDF, image, video, and audio payload flags.
- PDF, image, video, and audio payload file sizes.
- Input tokens.
- Output tokens.
- Total tokens.
- Local input token estimate.
- Latency.
- Input price.
- Output price.
- Estimated cost.
- Response text.
- Error text.
- Request payload.
- Response payload.
- Run started timestamp.
- Completed timestamp.
- Archive created timestamp.
- Archive updated timestamp.
- Suppressed flag.

Reporting mode:

- `Latest per checksum` reports only the newest observation for each `record_key`.
- `All observations` reports every archived run.

This makes it possible to see cost and token changes over time while still having a singular current record for each provider/model/input combination.

## Database Schema

`npm run db:setup` creates or repairs the tables and indexes.

Main tables:

```sql
model_presets
model_prices
model_price_records
run_results
```

`model_presets` stores named provider/model working sets:

```sql
model_presets (
  id bigserial primary key,
  name text not null,
  models jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

Preset names are unique case-insensitively. Saving a preset with an existing name overwrites the model list.

`model_prices` stores the effective legacy/current view:

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
```

`model_price_records` stores source-specific records:

```sql
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

`run_results` stores archived observations:

```sql
run_results (
  run_id text not null unique,
  record_key text not null,
  status text not null,
  provider_id text,
  provider_name text not null,
  service_provider text not null,
  model text not null,
  source_type text not null,
  source_label text not null,
  system_prompt text,
  system_prompt_hash text,
  user_message text,
  user_message_hash text,
  input_hash text not null,
  file_name text,
  file_path text,
  file_size bigint,
  file_type text,
  file_mime_type text,
  file_hash text,
  file_metadata jsonb,
  batch_files jsonb,
  pdf_sent boolean not null default false,
  pdf_file_size bigint,
  image_sent boolean not null default false,
  image_file_size bigint,
  video_sent boolean not null default false,
  video_file_size bigint,
  audio_sent boolean not null default false,
  audio_file_size bigint,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  local_input_tokens integer,
  latency_ms integer,
  input_price_per_1m numeric(12, 6),
  output_price_per_1m numeric(12, 6),
  estimated_cost numeric(18, 9),
  response_text text,
  error text,
  request_payload jsonb,
  response_payload jsonb,
  suppressed boolean not null default false,
  run_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
```

Important indexes cover:

- Completed time.
- Created time.
- Provider/model.
- Status.
- Input hash.
- File hash.
- Suppression state.
- Record key.

## API Routes

### `POST /api/models`

Fetches provider models using server-side API keys.

Returns normalized model metadata and any parsed pricing data available from provider discovery.

### `GET /api/model-presets`

Returns saved model presets.

### `PUT /api/model-presets`

Creates or overwrites a named model preset with the currently selected provider/model set.

### `DELETE /api/model-presets`

Deletes a model preset by ID.

### `POST /api/chat`

Runs a normalized prompt/file input through a provider adapter.

The route:

- Reads the provider API key from the environment.
- Builds the provider-specific request payload.
- Calls the provider.
- Normalizes text, token usage, latency, request payload, and response payload.
- Returns enough debug context for the Run tab.

### `GET /api/pricing`

Returns the effective model price map.

### `GET /api/pricing/records`

Returns all price records, including seed, provider-discovered, and manual records.

### `PUT /api/pricing`

Upserts a manual or provider-derived model price.

### `GET /api/results`

Returns recent archive rows.

### `POST /api/results`

Archives a completed run observation.

### `PATCH /api/results`

Suppresses or restores selected archive records.

### `DELETE /api/results`

Permanently deletes selected archive records.

## Environment Variables

Required database variable:

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

Local setup:

```powershell
vercel link
vercel env pull .env.local
```

Vercel environments should have the same provider keys when Production, Preview, and Development need the same provider behavior.

## Local Development

```powershell
cd TokenTesterWeb
npm install
vercel link
vercel env pull .env.local
npm run db:setup
npm run dev
```

Open:

```text
http://localhost:3000
```

## Pricing Imports

Create or repair tables:

```powershell
npm run db:setup
```

Import a local JSON or NDJSON file:

```powershell
npm run db:import-pricing -- path\to\prices.json
```

Seed from `simonw/llm-prices`:

```powershell
npm run db:import-pricing -- llm-prices
```

Supported pricing shapes include:

```json
[
  {
    "provider": "openrouter",
    "model": "openai/gpt-4o",
    "input": 2.5,
    "output": 10
  }
]
```

```json
{
  "openrouter": {
    "openai/gpt-4o": {
      "input": 2.5,
      "output": 10,
      "per": "1M"
    }
  }
}
```

```json
{
  "updated_at": "2026-06-09",
  "prices": [
    {
      "vendor": "openai",
      "id": "gpt-4o",
      "name": "GPT-4o",
      "input": 2.5,
      "output": 10
    }
  ]
}
```

## Vercel Deployment

The Vercel project must use:

```text
Root Directory: TokenTesterWeb
Framework Preset: Next.js
Build Command: npm run build
Output Directory: default
```

Deploy from local:

```powershell
cd TokenTesterWeb
vercel deploy --prod --yes
```

Inspect deployment:

```powershell
vercel inspect token-tester-web.vercel.app
vercel logs https://token-tester-web.vercel.app --level error --since 30m
vercel env ls
```

Production alias:

```text
https://token-tester-web.vercel.app
```

## Verification

Run before committing or deploying:

```powershell
npm run lint
npm run build
```

Useful API smoke test:

```powershell
node -e "fetch('https://token-tester-web.vercel.app/api/pricing').then(r=>console.log(r.status))"
```

Useful xAI model route test:

```powershell
@'
(async () => {
  const res = await fetch('https://token-tester-web.vercel.app/api/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'openai-compat',
      baseUrl: 'https://api.x.ai',
      apiKeyEnv: 'XAI_API_KEY'
    })
  })
  console.log(res.status, await res.text())
})()
'@ | node
```

## Operational Notes

- Vercel Git builds must run from `TokenTesterWeb`.
- The app is intended to be Vercel-only.
- Provider API keys should be set in Vercel environment variables and pulled locally through `vercel env pull`.
- Browser state stores provider configuration and selected models, but not secret provider keys.
- The Results Archive is the source of truth for historical runs.
- The current Results tab is session-oriented and queue-oriented.
- Suppressed archive records are not deleted.
- Deleted archive records cannot be restored through the UI.
- Provider-specific behavior belongs in adapter/capability modules, not scattered across UI components.
- Pricing key normalization belongs in `src/lib/pricing-match.ts`.

## Troubleshooting

If Gemini prices appear in the Pricing navigator but not on Gemini model cards, check canonical price lookup for `google/<model>` and direct Gemini model IDs such as `gemini-2.5-flash`.

If OpenRouter reports a model does not support image input, treat it as model-dependent. OpenRouter is a gateway; file/image support depends on the routed model and OpenRouter's own translation layer.

If OpenRouter PDFs appear unsupported, check that the provider adapter is `openrouter`, not a generic OpenAI-compatible adapter.

If xAI PDFs fail with a chat-completions content error, check that the deployed build is using the xAI Responses API path and that the Vercel project is building from the current `TokenTesterWeb` root.

If archive rows are missing, check:

- `DATABASE_URL` is set.
- `POST /api/results` is succeeding.
- Runs reached `success`, `error`, or `skipped`.
- Archive filters are not excluding the records.
- Visibility is not set to a mode that hides the desired rows.

If suppressed rows disappear, reset filters and set archive visibility to `All` or `Suppressed`.

If provider discovery works locally but not on Vercel, check:

- The relevant API key is set in the correct Vercel environment.
- The latest deployment was built after the key was added.
- The Vercel Root Directory is `TokenTesterWeb`.

## Git Workflow

```powershell
git status --short
npm run lint
npm run build
git add <changed-files>
git commit -m "<message>"
git push
vercel deploy --prod --yes
```
