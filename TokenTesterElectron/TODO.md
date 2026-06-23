# Electron Backlog

Future updates worth considering for the Electron codebase, based on improvements already made in the Vercel web app.

## Provider and Model Support

- Replace any remaining Groq preset/defaults with xAI.
- Add xAI model discovery through `https://api.x.ai/v1/models` using `XAI_API_KEY`.
- Parse xAI pricing fields from model discovery:
  - `prompt_text_token_price / 10000` -> USD per 1M input tokens.
  - `completion_text_token_price / 10000` -> USD per 1M output tokens.
- Add provider/model capability metadata so the UI can mark models as good for reasoning, coding, long context, vision, image generation, low cost, routed models, and general use.
- Make document and image support capability-driven rather than assuming all OpenAI-compatible providers accept the same request schema.

## Pricing

- Decide whether Electron should keep static `pricing/models.json`, use a local user pricing file, or optionally sync with the Neon-backed pricing source used by the web app.
- If keeping local pricing, add import support for the same JSON/NDJSON pricing shapes accepted by the web app.
- Persist manual model price edits automatically and make the saved location clear in the UI.
- Store prices consistently as USD per 1M input and output tokens.

## File and Attachment Handling

- Add explicit unsupported-attachment detection before inference.
- Treat DeepSeek providers and DeepSeek-routed models as text-only.
- Skip unsupported PDFs, DOCX files, images, or binary payloads before API calls, with zero tokens and zero cost.
- Do not retry provider-rejected attachments as placeholder text such as `[.PDF file]`; that can produce hallucinated answers.
- Add a visible skipped status with the provider/model-specific reason.
- Consider real PDF/DOCX text extraction before sending to text-only models, but only when extracted text is actually available and visible to the user.

## Queue and Results

- Add per-task retry for failed runs.
- Keep skipped runs separate from failed runs.
- Exclude skipped runs from analytics totals, cost calculations, token totals, and latency averages.
- Include skipped/error status and reason in exports.
- Preserve debug request/response views for actual provider calls while avoiding debug entries for skipped preflight runs.

## UI and Theme

- Add light, dark, and system theme modes.
- Port the SS&C-inspired color system with checked contrast in light mode.
- Add model-card capability lozenges.
- Review success/error/skipped dialog contrast in light mode.
- Add folder drag-and-drop parity with the web app if Electron does not already cover the same workflow.

## Architecture and Docs

- Update `ARCHITECTURE.md` if provider capabilities, pricing persistence, or attachment handling change.
- Keep Electron and web provider presets aligned where practical.
- Document any intentional divergence between desktop-local behavior and Vercel/Neon-backed behavior.
