# alkansave
AlkanSave: a shared family budget tracker in pesos. Log expenses from any phone, see who spent what, and track monthly budgets together in real time.

## Run it locally

Requires Node 20+.

```sh
npm install
cp .env.example .env.local   # then fill in the Firebase web app config
npm run dev                  # http://localhost:5173
npm run build                # production build in dist/
```

Without the `VITE_FIREBASE_*` values the app runs in device-only mode (entries saved in the browser).

## How it works

- Everyone signs in (Google or an emailed link) and belongs to one **family book** (`households/{id}` in Firestore).
- The person who creates a book is its **owner** and can invite family with a link that works for 7 days. People who join are **editors**.
- Entries, budgets and members live under the book; `firestore.rules` makes sure only its members can read or write them.
- Firestore keeps a copy on each phone, so the app opens and accepts entries offline and syncs when back online.
- "Use on this phone only" skips sign-in; signing in later offers to bring those entries into a new book.
- The owner can switch members between **Editor** and **View only**, or remove them (Accounts → Family). Others can leave a book.
- **Starting balances** (Accounts) set what each account held before logging began; the card is entered as the amount owed.
- **Recurring** entries (tick "Repeat every month" when adding one) are added automatically on their day by whichever family phone opens the app first. Entry ids are fixed per item and month (`r_{id}_{YYYY-MM}`), so they're never added twice.
- **Export** (Accounts) downloads the month's or all entries as CSV.

## Installing on a phone

AlkanSave is an installable web app (no app store needed):

- **Android (Chrome):** tap **Install** on the banner in the app, or ⋮ → **Install app**.
- **iPhone (Safari):** tap **Share** → **Add to Home Screen**. Sign in with Google inside the installed app.

`public/manifest.webmanifest` describes the app. `src/sw.js` saves the app's files so it opens offline; the build (`vite.config.js`) turns it into `dist/sw.js` with the list of built files and a new version on every change. Icons in `public/icons/` were made from `design/alkansave-logo.jpg`.

The first screen loads only the app itself (~16 KB gzipped); the Firebase SDK (~200 KB) is fetched right after, from `src/data/index.js`.

## Security rules

```sh
npm run test:rules     # runs tests/rules.test.js on the Firestore emulator (needs Java 21)
npx firebase login     # once
npm run deploy:rules   # publish firestore.rules to the alkansave project
```

CI runs the build and the rules tests on every pull request.

## Project layout

```
index.html              page markup
src/app.js              views, entry form, state
src/styles.css          styles (light and dark)
src/auth.js             sign-in, create/join a family book, invites (loaded on demand)
src/config.js           VITE_FIREBASE_* env vars; whether sync is set up
src/firebase.js         Firebase SDK setup (loaded on demand)
src/prefs.js            small per-browser settings
src/sw.js               service worker source (see vite.config.js)
src/data/index.js       picks the data source (connect()) and loads Firebase
src/data/firestore.js   Firestore with the same calls as local storage
src/data/local.js       device-only storage
firestore.rules         who can read and write what
tests/rules.test.js     rules tests
vercel.json             Vercel build settings
```

## Deploy

Vercel builds every push to `main`. Add the four `VITE_FIREBASE_*` variables in Vercel → Settings → Environment Variables, and add the Vercel domain in Firebase → Authentication → Settings → Authorized domains.
