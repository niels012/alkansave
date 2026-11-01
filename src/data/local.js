// Browser-only storage with the same calls app.js makes on the shared database.
// Used for "this phone only" mode, and when Firebase isn't configured.
const KEY = "alkansave.local";
const OLD_KEY = "kwarta.local";
const BACKUP_KEY = "alkansave.local.imported";

export function readLocal() {
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY)) || {}; } catch {}
  store.tx = store.tx || {};
  return store;
}

// After entries are copied to a family book, keep a backup copy but stop offering to import them.
export function archiveLocal() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    if (raw) localStorage.setItem(BACKUP_KEY, raw);
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_KEY);
  } catch {}
}

export function localDb() {
  const store = readLocal();
  const subs = [];
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} subs.forEach(f => f()); };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const watch = (cb, snap) => { const f = () => cb(snap()); subs.push(f); f(); };
  return {
    collection: () => ({
      doc: id => {
        const k = id || newId();
        return { set: async d => { store.tx[k] = d; persist(); }, delete: async () => { delete store.tx[k]; persist(); } };
      },
      onSnapshot: cb => watch(cb, () => ({ docs: Object.entries(store.tx).map(([id, d]) => ({ id, data: () => d })), metadata: { hasPendingWrites: false } }))
    }),
    doc: () => ({
      set: async d => { store.budgets = d; persist(); },
      onSnapshot: cb => watch(cb, () => ({ exists: !!store.budgets, data: () => store.budgets }))
    })
  };
}
