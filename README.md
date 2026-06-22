# Token Tester Vercel

This repository contains the original Electron app and a Vercel-deployable web port.

## Apps

- `TokenTesterElectron`: original Electron/Vite desktop app.
- `TokenTesterWeb`: Next.js App Router web app for Vercel.

## Web Workflow

```powershell
cd TokenTesterWeb
npm install
npm run lint
npm run build
vercel build
vercel deploy --prebuilt
```

Provider secrets are read only by Next.js route handlers from Vercel environment variables. See `TokenTesterWeb/.env.example` for supported keys.

Model pricing is stored in Neon Postgres when `DATABASE_URL` is configured. The bundled JSON pricing remains a fallback and seed source.

```powershell
npm run db:setup
npm run db:seed-pricing
```
