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
- **Starting balances** (Accounts) set what each account held before logging began; Atome and SPayLater are entered as the amount owed.
- **Recurring** entries (tick "Repeat every month" when adding one) repeat on a date (the 15th) or a weekday (the first Monday, the last Friday); `src/schedule.js` works out the day. They're added automatically on their day by whichever family phone opens the app first. Entry ids are fixed per item and month (`r_{id}_{YYYY-MM}`), so they're never added twice.
- **Export** (Accounts) downloads the month's or all entries as CSV.

## Installing on a phone

AlkanSave is an installable web app (no app store needed):

- **Android (Chrome):** tap **Install** on the banner in the app, or ⋮ → **Install app**.
- **iPhone (Safari):** tap **Share** → **Add to Home Screen**. Sign in with Google inside the installed app.

`public/manifest.webmanifest` describes the app. `src/sw.js` saves the app's files so it opens offline; the build (`vite.config.js`) turns it into `dist/sw.js` with the list of built files and a new version on every change. Icons in `public/icons/` were made from `design/alkansave-logo.jpg`.

The first screen loads only the app itself (~16 KB gzipped); the Firebase SDK (~200 KB) is fetched right after, from `src/data/index.js`.

## Bill reminders

Each phone can turn on reminders in **Budget → Bill reminders**. At 8 AM Philippine time, Vercel Cron calls `api/reminders.js`, which finds repeating bills due tomorrow in each family book and sends one notification to every phone that turned reminders on (Firebase Cloud Messaging). On iPhone this works only in the installed Home Screen app.

Setup (once):

- `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_VAPID_KEY` (Firebase → Project settings → Cloud Messaging → Web Push certificates) in `.env.local` and Vercel.
- `FIREBASE_SERVICE_ACCOUNT` (the JSON of a key from Firebase → Project settings → Service accounts) and `CRON_SECRET` (any long random string) in Vercel only, as secrets.

Send reminders now for a given due date (e.g. to test):

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/reminders?date=2026-12-05"
```

`npm test` checks which bills are due when and the reminder wording (`api/_due.js`).

## Logging from other apps

`api/log.js` lets another app add one expense, e.g. the meal planner's **Done Market** button (note "Carbon Market", Food, Cash). It's logged as the person with `LOG_AS_EMAIL`, in the family book they last opened, and only if they can edit it. Each request carries an id, so a retry never adds the same entry twice.

Setup (once), in Vercel → Settings → Environment Variables, as secrets:

- `LOG_SECRET`: any long random string; the other app sends it as `Authorization: Bearer …`
- `LOG_AS_EMAIL`: the email you sign in to AlkanSave with

It uses the same `FIREBASE_SERVICE_ACCOUNT` as bill reminders.

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
