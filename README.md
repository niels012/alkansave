# alkansave
AlkanSave: a shared family budget tracker in pesos. Log expenses from any phone, see who spent what, and track monthly budgets together in real time.

## Run it locally

Requires Node 20+.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

Entries are saved in the browser for now. Firebase sync comes in a later phase.

## Project layout

```
index.html           page markup
src/app.js           views, entry form, state
src/styles.css       styles (light and dark)
src/data/index.js    picks the data source (connect())
src/data/local.js    browser-only storage
vercel.json          Vercel build settings
.env.example         Firebase config names (Phase 2)
```

## Deploy

Import the GitHub repo in Vercel. It detects Vite from `vercel.json`, so no extra settings are needed.
