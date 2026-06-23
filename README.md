# Token Tester Web

Token Tester Web is the Vercel-deployed Next.js app for comparing model responses, token usage, latency, and estimated cost across multiple AI providers while keeping provider API keys on the server.

## Workflow

```powershell
cd TokenTesterWeb
npm install
npm run lint
npm run build
vercel deploy --prod --yes
```

Provider secrets are read only by Next.js route handlers from Vercel environment variables. Model pricing is stored in Neon Postgres, and the deployed app can seed from `llm-prices` or accept provider-discovered and manual overrides.

The production app is deployed at:

```text
https://token-tester-web.vercel.app
```

Current behavior notes:

- Gemini pricing is canonicalized under `google/*`.
- Manual model price edits and provider-discovered prices persist to Neon.
- Failed queue tasks can be retried individually.
- Unsupported binary attachments are skipped before inference and count as zero tokens/cost.
- DeepSeek and DeepSeek-routed models are treated as text-only; PDFs and other document attachments are skipped rather than sent as placeholder prompts.
