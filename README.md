# Token Tester Vercel

This repository contains the original Electron app and a Vercel-deployable web port.

## Apps

- `TokenTesterElectron`: original Electron/Vite desktop app.
- `TokenTesterWeb`: Next.js App Router web app for Vercel. See `TokenTesterWeb/README.md` for the full Vercel architecture, environment, database, and deploy guide.

## Web Workflow

```powershell
cd TokenTesterWeb
npm install
npm run lint
npm run build
vercel deploy --prod --yes
```

Provider secrets are read only by Next.js route handlers from Vercel environment variables. See `TokenTesterWeb/.env.example` for supported keys.

Model pricing is stored in Neon Postgres. Static pricing files are not used by the deployed app.

```powershell
npm run db:setup
npm run db:import-pricing -- path\to\model-prices.json
```

The production web app is deployed at:

```text
https://token-tester-web.vercel.app
```

Current web behavior notes:

- xAI replaces the old Groq preset and uses `XAI_API_KEY`.
- Manual model price edits and provider-discovered prices persist to Neon.
- Failed queue tasks can be retried individually.
- Unsupported binary attachments are skipped before inference and count as zero tokens/cost.
- DeepSeek and DeepSeek-routed models are treated as text-only; PDFs and other document attachments are skipped rather than sent as placeholder prompts.
