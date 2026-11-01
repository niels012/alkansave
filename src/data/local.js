// Browser-only storage with the same calls app.js makes on the shared database.
// Used until Firebase is connected (Phase 3), and later as the signed-out fallback.
const KEY = "alkansave.local";
const OLD_KEY = "kwarta.local";

export function localDb() {
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY)) || {}; } catch {}
  store.tx = store.tx || {};
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
