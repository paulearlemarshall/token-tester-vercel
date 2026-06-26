# Agent Brief: Model Capability Pills And Model Stats

## Context

Apply the web-side feature changes from the local branch `model-capabilities-update` to the original repository at:

```text
https://github.com/chrisjgaze/token-tester-vercel.git
```

Comparison base used for this brief:

```text
upstream/main
```

Current local branch being summarized:

```text
model-capabilities-update
```

The deployable app is under:

```text
TokenTesterWeb/
```

Focus on the web application changes. Do not copy local-only instruction file churn such as `AGENTS.md` rewrites unless explicitly requested.

## Feature Goals

1. Add inferred "Good for" capability pills to model cards on the Run page.
2. Allow multi-select capability filtering on the Run page.
3. Add a compact price sort icon for Run page model lists.
4. Add a new sidebar section called `Model Stats`.
5. Persist document category metadata for archived runs.
6. Add AI-assisted document categorization with heuristic fallback.
7. Add a local file-backed persistence fallback when `DATABASE_URL` is not configured.
8. Fix the hydration mismatch by rendering the main app client-side only.
9. Add Vercel deployment config and docs for the `TokenTesterWeb` root directory.

## Run Page Changes

### New capability inference utility

Create:

```text
TokenTesterWeb/src/utils/model-capabilities.ts
```

It should export:

- `ModelCapability`
- `CAPABILITY_LABELS`
- `CAPABILITY_STYLES`
- `inferModelCapabilities(modelId, meta, pricing)`

Supported capabilities:

```text
ocr
invoice
extraction
vision
reasoning
thinking
coding
fast
low-cost
long-context
audio
image-generation
legacy
```

Infer tags from model ID patterns, provider model metadata, modalities, context length, and pricing. For example:

- Vision models should also get `OCR` and `Invoices`.
- Reasoning models should get `Reasoning`; thinking models should get `Thinking`.
- Cheap models should get `Low cost` when input price is <= 1 USD per 1M and output price is <= 3 USD per 1M.
- Models with context length >= 128k should get `Long ctx`.

### Update `RunTab`

Update:

```text
TokenTesterWeb/src/components/RunTab.tsx
```

Required behavior:

- Replace the previous inline model lozenge logic with `inferModelCapabilities`.
- Show capability pills on each model card.
- Add a `Good for` filter row above the model grid for each expanded provider.
- Capability filters must be multi-select.
- Filtering should match models that have any selected capability.
- The filter line should show:

```text
{showing} of {total} showing · inferred guidance
```

- Add a `DollarSign` icon button near the existing sort control.
- The price icon toggles `price-asc` and `price-desc`.
- Price sort should use combined input plus output price from `effectivePricing`.
- Preserve existing sort cycle behavior for name/input/output/active sorting.

Implementation notes:

- Add a `ModelSortMode` type that includes `price-asc` and `price-desc`.
- Store capability filters as `Record<string, ModelCapability[]>`.
- Include a helper that normalizes old/single capability state into an array to avoid Fast Refresh crashes.

## Model Stats Feature

### Add sidebar tab

Update:

```text
TokenTesterWeb/src/types.ts
TokenTesterWeb/src/components/layout/Sidebar.tsx
TokenTesterWeb/src/components/TokenTesterApp.tsx
```

Required behavior:

- Extend `TabId` with `modelStats`.
- Add a sidebar item:

```text
Model Stats
```

- Render the new `ModelStatsTab` when active.

### Add model stats row builder

Create:

```text
TokenTesterWeb/src/lib/model-stats.ts
```

It should export:

- `ModelStatsRow`
- `buildModelStatsRows(records)`

Rows should be built from archived run records, excluding suppressed records.

Group by:

```text
providerName
model
documentType
documentCategory
```

Do not group by category source.

Compute:

- runs
- success rate
- average total tokens
- average cost
- average latency
- average file size
- average extracted feature count
- cost per extracted feature
- total cost
- last run timestamp
- average document category confidence

Document type should be inferred from stored flags and file metadata:

- PDF
- Image
- Audio
- Video
- Text
- Document
- Batch
- Prompt only
- Unknown

Extracted feature count should be estimated from successful response text:

- Prefer parsed JSON leaf count.
- Fall back to labeled `key: value` lines.
- Fall back to bullet or numbered list count.

### Add Model Stats UI

Create:

```text
TokenTesterWeb/src/components/ModelStatsTab.tsx
```

Required behavior:

- Load archived results with `webApi.getArchivedResults(5000)`.
- Show summary metrics:
  - Grouped Runs
  - Avg Success
  - Total Cost
- Provide filters:
  - free-text search
  - provider
  - model
  - category
  - document type
- Provide a sortable table. Clicking any column header toggles descending/ascending.
- Show sort direction with small up/down icons.
- Numeric columns sort numerically.
- `Last Run` sorts by date.
- `Cost / Feature` null values sort to the bottom.
- Show category as:

```text
Invoice (87%)
```

- Do not show a separate category source column.
- Show `Last Run` as relative text:

```text
Today
1 day ago
2 days ago
```

- Put the exact timestamp in the cell `title` for hover.

Table columns:

- Provider
- Model
- Category
- Doc Type
- Runs
- Success
- Avg Tokens
- Avg Cost
- Avg Latency
- Avg Size
- Avg Features
- Cost / Feature
- Total Cost
- Last Run

## Document Category Classification

### Shared category helper

Create:

```text
TokenTesterWeb/src/lib/document-category.ts
```

Categories:

```text
Utility bill
Invoice
Receipt
Medical record
Bank statement
Contract
ID document
Tax document
Form
Email
Resume
Uncategorized
```

Export:

- `DOCUMENT_CATEGORIES`
- `DocumentCategory`
- `DocumentCategoryInput`
- `DocumentCategoryResult`
- `heuristicDocumentCategory(input)`
- `categoryInputFromRecord(record)`
- `isDocumentCategory(value)`

The heuristic should inspect filename, path, source label, user prompt, response text, file content, and metadata text.

### API route

Create:

```text
TokenTesterWeb/src/app/api/document-category/route.ts
```

Behavior:

- `POST` accepts `DocumentCategoryInput`.
- If `OPENAI_API_KEY` is not configured, return the heuristic result.
- If `OPENAI_API_KEY` is configured, call the OpenAI Responses API.
- Model should be `process.env.DOCUMENT_CATEGORY_MODEL || 'gpt-4o-mini'`.
- Return only:

```ts
{ category: string; confidence: number; source: 'ai' | 'heuristic' }
```

- If the AI request fails, returns invalid JSON, or returns an unknown category, fall back to heuristic.
- Limit prompt payload size by truncating user message, response text, and file content before sending.

### Web API wrapper

Update:

```text
TokenTesterWeb/src/lib/web-api.ts
```

Add:

```ts
classifyDocumentCategory(params)
```

It should POST to:

```text
/api/document-category
```

### Archive persistence changes

Update:

```text
TokenTesterWeb/src/types.ts
TokenTesterWeb/src/lib/run-results.ts
TokenTesterWeb/src/components/RunTab.tsx
```

Add fields to `ArchivedRunResult` and save input:

```ts
documentCategory?: string | null
documentCategoryConfidence?: number | null
documentCategorySource?: string | null
```

Database schema additions:

```sql
document_category text
document_category_confidence numeric(5, 4)
document_category_source text
```

Use `alter table add column if not exists` so existing Neon databases migrate safely.

When archiving a run in `RunTab`, call `webApi.classifyDocumentCategory` with:

- file name
- file path
- source label
- user message
- file metadata
- response text
- file content or joined batch file content

Save the returned category metadata with the archived run. If classification fails, continue archiving with null category fields.

## Local Persistence Fallback

Create:

```text
TokenTesterWeb/src/lib/local-persistence.ts
```

Purpose:

- Allow local testing without Neon.
- Use file-backed JSON storage when `DATABASE_URL` is not configured.

Storage directory:

```text
TokenTesterWeb/.local-data/
```

Support local persistence for:

- archived run results
- pricing records
- file prompts

Update:

```text
TokenTesterWeb/src/lib/run-results.ts
TokenTesterWeb/src/lib/pricing.ts
TokenTesterWeb/src/lib/file-prompts.ts
```

Each module should check:

```ts
shouldUseLocalPersistence()
```

and route to the local implementation when true.

Update:

```text
TokenTesterWeb/.gitignore
```

Add:

```text
.local-data/
```

## Hydration Fix

Create:

```text
TokenTesterWeb/src/components/TokenTesterClient.tsx
```

Use `next/dynamic` with `ssr: false` to load `TokenTesterApp`.

Update:

```text
TokenTesterWeb/src/app/page.tsx
```

Render `TokenTesterClient` instead of importing `TokenTesterApp` directly.

Reason:

- The app uses persisted client state/localStorage.
- Rendering the whole interactive app only on the client avoids server/client HTML mismatch.

## Vercel And Environment Docs

Add:

```text
TokenTesterWeb/vercel.json
```

Suggested content:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm ci"
}
```

Update:

```text
TokenTesterWeb/.env.example
```

Add:

```text
DOCUMENT_CATEGORY_MODEL=
```

Update README files to document:

- Vercel Root Directory must be `TokenTesterWeb`.
- If a deployed site shows Vercel 404, check the Root Directory setting first.
- Local testing can run without `DATABASE_URL`; the app will use `.local-data/`.
- `DOCUMENT_CATEGORY_MODEL` is optional and defaults to `gpt-4o-mini`.
- `OPENAI_API_KEY` enables AI document categorization; otherwise heuristic categorization is used.

## Files To Add

```text
TokenTesterWeb/src/app/api/document-category/route.ts
TokenTesterWeb/src/components/ModelStatsTab.tsx
TokenTesterWeb/src/components/TokenTesterClient.tsx
TokenTesterWeb/src/lib/document-category.ts
TokenTesterWeb/src/lib/local-persistence.ts
TokenTesterWeb/src/lib/model-stats.ts
TokenTesterWeb/src/utils/model-capabilities.ts
TokenTesterWeb/vercel.json
```

## Files To Modify

```text
README.md
TokenTesterWeb/.env.example
TokenTesterWeb/.gitignore
TokenTesterWeb/README.md
TokenTesterWeb/src/app/page.tsx
TokenTesterWeb/src/components/RunTab.tsx
TokenTesterWeb/src/components/TokenTesterApp.tsx
TokenTesterWeb/src/components/layout/Sidebar.tsx
TokenTesterWeb/src/lib/file-prompts.ts
TokenTesterWeb/src/lib/pricing.ts
TokenTesterWeb/src/lib/run-results.ts
TokenTesterWeb/src/lib/web-api.ts
TokenTesterWeb/src/types.ts
```

## Validation

From:

```text
TokenTesterWeb/
```

Run focused checks:

```bash
npx eslint src/components/RunTab.tsx src/components/ModelStatsTab.tsx src/lib/model-stats.ts src/lib/document-category.ts src/app/api/document-category/route.ts
npm run build
```

Known note:

- Full `npm run lint` may expose pre-existing warnings/errors outside this feature area. Do not treat unrelated existing lint failures as part of this implementation unless the target branch has already fixed them.

## Acceptance Criteria

- Run page model cards show capability pills.
- Run page `Good for` pills support multi-select filtering.
- Run page model count updates as filters change.
- Run page dollar icon sorts models by combined input/output price.
- Sidebar contains `Model Stats`.
- Model Stats loads archive data and groups by provider, model, document type, and category.
- Model Stats table supports search, provider/model/category/document-type filters, and clickable sortable headers.
- Category displays confidence inline, for example `Invoice (87%)`.
- Last run displays relative day text and exact timestamp on hover.
- Completed runs archive document category metadata when available.
- App runs locally without `DATABASE_URL` using `.local-data/`.
- Production build succeeds.
