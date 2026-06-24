<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Token Tester Web Agent Notes

This directory is the Vercel-deployable Next.js App Router port of the Token Tester app. Treat `TokenTesterWeb` as the deploy root for Vercel commands.

## Project Shape

- `src/app`: Next.js routes, layout, global CSS, and server API route handlers.
- `src/components`: client UI tabs for configure, prompts, run, results, and navigation.
- `src/lib/provider-api.ts`: server-side provider discovery and chat completion adapters.
- `src/lib/pricing.ts`: Neon-backed model pricing reads and writes.
- `src/store.ts`: Zustand browser state and localStorage migrations.
- `src/utils/constants.ts`: built-in provider presets.
- `scripts`: Neon schema setup and pricing import utilities.

## Vercel Rules

- Deploy from `TokenTesterWeb`, not the repository root.
- Production URL is `https://token-tester-web.vercel.app`.
- Use `vercel env ls` before assuming a secret exists.
- Use `vercel env pull .env.local` for local server-side testing.
- Run `npm run lint` and `npm run build` before production deploys.
- Deploy with `vercel deploy --prod --yes`.
- Check `vercel inspect token-tester-web.vercel.app` and recent error logs after deploy.

## Data and Secrets

- Provider API keys must stay server-side in route handlers.
- The browser may send an env var name such as `XAI_API_KEY`, but never the secret value.
- Model pricing is sourced from Neon Postgres through `/api/pricing`.
- Static pricing bundles are not used at runtime.
- Manual price edits and fetched provider prices should be persisted through `PUT /api/pricing`.
- Prices are stored as USD per 1M tokens.

## Provider Notes

- OpenAI-compatible providers (openrouter, deepseek, mistral, etc.) call `{baseUrl}/v1/models` and `{baseUrl}/v1/chat/completions`.
- The `openai` adapter uses the Responses API at `{baseUrl}/v1/responses` with `input` (content parts: `input_text`, `input_image`, `input_file`, `input_audio`) and top-level `instructions` instead of system messages.
- Audio attachments use `input_audio` with `{ type: "input_audio", data, format }` in the Responses API.
- The `openrouter` adapter uses OpenRouter's `input_audio` content part with `inputAudio: { data, format }`.
- OpenRouter model discovery stores `architecture.input_modalities` and `architecture.output_modalities`; audio-only runs on transcription-output models use `/v1/audio/transcriptions`.
- xAI is configured as OpenAI-compatible at `https://api.x.ai` using `XAI_API_KEY`.
- xAI runs use `/v1/responses`; audio attachments are first transcribed through `/v1/stt`, then sent as transcript text to the response model.
- xAI model discovery returns prices in USD cents per 100M tokens; divide by `10000` before storing as USD per 1M tokens.
- Anthropic and Gemini use provider-specific adapters; Gemini sends audio/video/image/document files as `inlineData`.
- Treat DeepSeek providers and DeepSeek-routed models as text-only.
- Do not retry unsupported binary attachments as placeholder text. Mark unsupported or provider-rejected attachments as `skipped` with zero tokens/cost.
- Default audio-only file prompts should ask for speech-to-text; custom prompts still override defaults.
- Be conservative with document support for generic OpenAI-compatible gateways; only allow PDFs/DOCX when the provider schema is known to support the request shape.

## Git Rules

- Keep commits scoped to the task.
- Do not revert unrelated user changes.
- Commit and push deployable changes before production deployment.
