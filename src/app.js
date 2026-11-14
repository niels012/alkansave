import { connect } from "./data/index.js";
import { leaveDeviceOnly } from "./prefs.js";
import { isIOS, isAndroid, isStandalone } from "./device.js";
import { hideSplash } from "./splash.js";
import { dueDate, patternsFor, repeatLabel, byWeekday, WEEKS, WEEKDAYS } from "./schedule.js";

// ---------- No zooming ----------
// The app is laid out for phone screens, so it doesn't zoom. index.html's viewport turns zoom off and stops the
// iPhone zooming in on a tapped box, and styles.css stops double-tap zoom, but Safari on iPhone ignores the
// viewport's no-zoom setting for pinching, so pinches (two fingers) are cancelled here.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, e => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// ---------- Reference data ----------
const CATS = {
  expense: [
    { k: "tithing", n: "Donation", e: "🙏", c: "#6366F1" }, // was "Tithing"; the key stays so saved entries and limits keep it
    { k: "food", n: "Food", e: "🍜", c: "#FF5A36" },
    { k: "groceries", n: "Groceries", e: "🛒", c: "#22C55E" },
    { k: "transport", n: "Transport", e: "🚌", c: "#3B82F6" },
    { k: "bills", n: "Bills & Utilities", e: "💡", c: "#FFC800" },
    { k: "household", n: "Household", e: "🏠", c: "#8B5CF6" },
    { k: "kids", n: "Kids & School", e: "🎒", c: "#D946EF" },
    { k: "health", n: "Health", e: "💊", c: "#14B8A6" },
    { k: "shopping", n: "Shopping", e: "🛍️", c: "#FF9F1C" },
    { k: "leisure", n: "Leisure", e: "🎬", c: "#A3E635" },
    { k: "padala", n: "Padala & Family", e: "💌", c: "#FF4D8D" },
    { k: "pet", n: "Pet", e: "🐾", c: "#22D3EE" },
    { k: "other", n: "Other", e: "📦", c: "#94A3B8" }
  ],
  income: [
    { k: "salary", n: "Salary", e: "💼", c: "#3B82F6" },
    { k: "business", n: "Business", e: "🏪", c: "#22C55E" },
    { k: "bonus", n: "13th Month & Bonus", e: "🎁", c: "#A855F7" },
    { k: "gift", n: "Gifts", e: "🧧", c: "#FF4D6D" },
    { k: "interest", n: "Interest", e: "📈", c: "#14B8A6" }, // e.g. MariBank's daily interest (see "Bank interest")
    { k: "other_in", n: "Other income", e: "➕", c: "#94A3B8" }
  ]
};
const TRANSFER = { k: "transfer", n: "Transfer", e: "🔁", c: "#7A8882" };
// Cash and Atome are shared by the whole family (one of each). GCash, GoTyme, MariBank and PSBank are
// personal: every family member has their own, and an entry uses the account of whoever logged it.
// Atome and SPayLater are pay-later accounts that work like credit cards ("owed"): spending on them is money owed,
// not money on hand, their starting balance is entered as the amount owed, and paying them is a transfer in.
// Atome keeps the key "card" (it was "Credit card"), so entries and starting amounts already saved still count.
const ACCOUNTS = [
  { k: "cash", n: "Cash", e: "💵", c: "#4C9A66", shared: true },
  { k: "gcash", n: "GCash", logo: "/icons/banks/gcash.webp" },
  { k: "gotyme", n: "GoTyme", logo: "/icons/banks/gotyme.webp" },
  { k: "maribank", n: "MariBank", logo: "/icons/banks/maribank.webp" },
  { k: "psbank", n: "PSBank", logo: "/icons/banks/psbank.webp", ownerOnly: true },
  { k: "spaylater", n: "SPayLater", logo: "/icons/banks/spaylater.webp", ownerOnly: true, owed: true },
  { k: "card", n: "Atome", logo: "/icons/banks/card.webp", shared: true, owed: true }
];
const isOwed = k => !!(ACCOUNTS.find(a => a.k === k) || {}).owed;
const INTEREST_ACCOUNT = "maribank"; // the account whose balance you can tap to log its interest
const SHARED_ACCOUNTS = ACCOUNTS.filter(a => a.shared);
const PERSONAL_ACCOUNTS = ACCOUNTS.filter(a => !a.shared);
const isShared = k => SHARED_ACCOUNTS.some(a => a.k === k);
// Accounts from before; kept so older entries and starting amounts still add up, but not offered for new entries.
const OLD_ACCOUNTS = [
  { k: "maya", n: "Maya", e: "📲", c: "#2A9F9C" },
  { k: "bank", n: "Bank", e: "🏦", c: "#8C69BD" }
];
const ALL_ACCOUNTS = [...ACCOUNTS, ...OLD_ACCOUNTS];
// Deel is in US dollars: it's only shown (its own row under Net on Accounts) and never added to the peso totals.
// Nobody logs entries in it; its balance is typed in under Starting balances.
const DEEL = { k: "deel", n: "Deel", logo: "/icons/banks/deel.webp", ownerOnly: true };
const catOf = (type, k) => type === "transfer" ? TRANSFER : (CATS[type] || CATS.expense).find(c => c.k === k) || (type === "income" ? CATS.income.find(c => c.k === "other_in") : CATS.expense.find(c => c.k === "other"));
const acctOf = k => ALL_ACCOUNTS.find(a => a.k === k) || ACCOUNTS[0];
const acctIcon = a => a.logo
  ? `<span class="ico logo" aria-hidden="true"><img src="${a.logo}" alt="" width="38" height="38"></span>`
  : `<span class="ico" style="--c:${a.c}" aria-hidden="true">${a.e}</span>`;
const VIEWS = ["daily", "calendar", "stats", "budget", "accounts"];

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Money: whole amounts as "₱2,500", anything with centavos as "₱2,500.50" (never "₱2,500.5"). Same for dollars.
const currency = (code, locale) => {
  const [whole, cents] = [0, 2].map(d => new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: d, maximumFractionDigits: d }));
  return n => { const v = Math.round((n || 0) * 100) / 100; return (v % 1 ? cents : whole).format(v); };
};
const peso = currency("PHP", "en-PH");
const usd = currency("USD", "en-US");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shiftMonth = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
const monthLabel = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" }); };
const daysIn = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
// White or dark text, whichever reads better on a "#RRGGBB" colour (bright yellows and greens get dark text).
const inkOn = hex => {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.06 ? "#fff" : "#111A2C";
};
const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };

// ---------- State ----------
const S = {
  month: todayISO().slice(0, 7), view: "daily", statType: "expense", selDay: todayISO(),
  db: null, user: null, meId: null, isOwner: false, canWrite: true,
  tx: [], budgets: {}, loaded: false, live: "connecting", profiles: {},
  demo: false, demoTx: [], demoBudgets: {}, demoPhotos: {}, local: false,
  editing: null, delArmed: false, notice: "", canSignIn: false,
  recurring: [], recLoaded: false, legacyStart: {}, legacyStartBy: null, sharedStart: null, armed: "",
  editingRec: null, q: "", searchOpen: false, showFilters: false, f: { type: "", cat: "", who: "", acct: "", scope: "month" },
  rem: "", remBusy: false, statOpen: null, balOpen: false, openTrouble: "", undo: null
};
try { const h = location.hash.slice(1); if (VIEWS.includes(h)) S.view = h; } catch {}
// A tapped bill reminder opens "/#budget" in an already-open app.
addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== S.view) { S.view = h; draw(); } });
try { const v = localStorage.getItem("alkansave.view"); if (!location.hash && VIEWS.includes(v)) S.view = v; } catch {}

const MAX_PHOTOS = 3; // receipt photos per entry (see "Receipt photos")
// An entry deleted from its row stays hidden here until its Undo runs out (see deleteWithUndo).
const hiddenTx = new Set();
const txAll = () => { const list = S.demo ? S.demoTx : S.tx; return hiddenTx.size ? list.filter(t => !hiddenTx.has(t.id)) : list; };
const budgets = () => S.demo ? S.demoBudgets : S.budgets;
const monthTx = () => txAll().filter(t => t.date.slice(0, 7) === S.month);
// Upcoming entries: dated after today. They show in the list (greyed, under "Upcoming") but aren't counted in any
// total, balance, budget or stat until their day comes. "Counted" lists are what everything that adds up reads.
const isUpcoming = t => t.date > todayISO();
const countedTx = () => txAll().filter(t => !isUpcoming(t));
const monthCounted = () => monthTx().filter(t => !isUpcoming(t));

function clean(id, d) {
  if (!d || typeof d !== "object") return null;
  const type = ["expense", "income", "transfer"].includes(d.type) ? d.type : null;
  const amount = Number(d.amount);
  if (!type || !(amount > 0) || amount > 1e10 || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ""))) return null;
  return {
    id, type, amount, date: d.date,
    cat: String(d.cat || "other"), acct: String(d.acct || "cash"), to: d.to ? String(d.to) : null,
    note: String(d.note || "").slice(0, 200),
    by: typeof d.by === "string" ? d.by : null,
    createdAt: Number(d.createdAt) || 0, updatedAt: Number(d.updatedAt) || 0,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
    toWho: d.type === "transfer" && typeof d.toWho === "string" && d.toWho ? d.toWho : null, // sent to another family member
    loggedBy: typeof d.loggedBy === "string" && d.loggedBy ? d.loggedBy : null, // entered by someone else for "by"
    order: Number.isFinite(d.order) ? d.order : null,
    photos: Number.isInteger(d.photos) && d.photos > 0 ? Math.min(d.photos, MAX_PHOTOS) : 0,
    desc: String(d.desc || "").slice(0, 200) // describes its photos
  };
}
// Position within its day: smaller first. Entries nobody has moved sort newest-logged first; a moved one
// gets an order between its new neighbours (see "Long-press an entry to move it").
const posOf = t => t.order ?? -t.createdAt;
const newestDayFirst = (a, b) => b.date.localeCompare(a.date) || posOf(a) - posOf(b);
function cleanLimits(l) {
  const out = {};
  if (l && typeof l === "object") for (const c of CATS.expense) { const v = Number(l[c.k]); if (v > 0 && v < 1e10) out[c.k] = v; }
  return out;
}
function cleanStarts(s) {
  const out = {};
  if (s && typeof s === "object") for (const a of [...ALL_ACCOUNTS, DEEL]) { const v = Number(s[a.k]); if (v && Math.abs(v) < 1e10) out[a.k] = v; }
  return out;
}
function cleanRec(id, d) {
  if (!d || !["expense", "income"].includes(d.type) || !(Number(d.amount) > 0)) return null;
  return {
    id, type: d.type, amount: Number(d.amount),
    cat: String(d.cat || "other"), acct: String(d.acct || "cash"), note: String(d.note || "").slice(0, 200),
    day: Math.min(31, Math.max(1, Math.round(Number(d.day)) || 1)),
    // Repeating on a weekday instead of a date (src/schedule.js): week 1–4 or 5 (last), weekday 0–6.
    ...(byWeekday({ week: Number(d.week), weekday: Number(d.weekday) }) ? { week: Number(d.week), weekday: Number(d.weekday) } : {}),
    lastPosted: /^\d{4}-\d{2}$/.test(String(d.lastPosted || "")) ? d.lastPosted : todayISO().slice(0, 7),
    active: d.active !== false, createdBy: typeof d.createdBy === "string" ? d.createdBy : null, createdAt: Number(d.createdAt) || 0
  };
}
// The fields a recurring doc is saved with (no id); week and weekday only when it repeats on a weekday.
const recData = r => ({
  type: r.type, amount: r.amount, cat: r.cat, acct: r.acct, note: r.note, day: r.day,
  ...(byWeekday(r) ? { week: r.week, weekday: r.weekday } : {}),
  lastPosted: r.lastPosted, active: r.active, createdBy: r.createdBy, createdAt: r.createdAt
});
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
// When a recurring item will next be added, as "Dec 1".
const recNext = r => new Date(`${dueDate(r, shiftMonth(r.lastPosted, 1))}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const parseAmount = raw => Math.round((parseFloat(String(raw).replace(/[₱,\s]/g, "")) || 0) * 100) / 100;
// Amount boxes show thousands separators as you type ("250000" → "250,000"); everything that reads them drops the commas.
function withCommas(raw) {
  const s = String(raw).replace(/[^\d.-]/g, "");
  const neg = s.startsWith("-") ? "-" : "";
  const [int = "", ...rest] = s.replace(/-/g, "").split(".");
  const dec = rest.length ? "." + rest.join("").slice(0, 2) : "";
  return neg + int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + dec;
}
const grouped = n => n ? withCommas(String(n)) : "";

// ---------- People ----------
const DEMO_PEOPLE = {
  "demo-a": { name: "You", color: "#1F55D0", avatar: "", isMe: true },
  "demo-b": { name: "Partner", color: "#C2507F", avatar: "", isMe: false }
};
function who(id) {
  if (S.demo) return DEMO_PEOPLE[id] || DEMO_PEOPLE["demo-a"];
  const p = id ? S.profiles[id] : null;
  const isMe = !!id && id === S.meId;
  return { name: isMe ? "You" : ((p && p.name) || "Family member"), color: (p && p.color) || "#7A8882", avatar: (p && p.avatarUrl) || "", isMe };
}
// `name`, when given, is used for the initials instead (e.g. your real name rather than "You").
function avatar(id, sm, name) {
  const p = who(id);
  const initials = esc((name || p.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase());
  // The photo sits over the initials; if it fails to load (expired link, offline) it removes itself.
  return `<span class="av${sm ? " sm" : ""}" style="--c:${esc(p.color)}">${initials}${p.avatar ? `<img src="${esc(p.avatar)}" alt="" onerror="this.remove()">` : ""}</span>`;
}
let profSeq = 0, profKey = "";
function refreshProfiles() {
  if (!S.user || S.demo) return;
  const ids = [...new Set([S.meId, ...S.tx.map(t => t.by), ...S.tx.map(t => t.updatedBy)].filter(Boolean))];
  if (!ids.length) return;
  const seq = ++profSeq;
  S.user.profiles(ids).then(ps => {
    if (seq !== profSeq) return;
    const key = ids.map(i => `${i}:${ps[i] && ps[i].name}:${ps[i] && ps[i].avatarUrl}`).join("|");
    S.profiles = ps;
    if (key !== profKey) { profKey = key; draw(); }
  });
}

// ---------- Sample data (local only, never saved) ----------
// A month with every category in it. Early in the current month the days are squeezed into the ones
// that have passed, so the whole sample still shows without entries dated in the future.
function buildDemo() {
  const m = S.month, last = m === todayISO().slice(0, 7) ? Number(todayISO().slice(8)) : daysIn(m);
  const day = d => last >= 28 ? d : Math.max(1, Math.ceil(d * last / 28));
  const rows = [
    [1, "income", "salary", 32000, "maribank", "a", "Sahod, 1st cutoff"],
    [1, "expense", "bills", 14500, "maribank", "a", "Rent"],
    [2, "expense", "groceries", 3860, "card", "b", "Weekly groceries"],
    [2, "expense", "transport", 180, "cash", "a", "Jeep & tricycle"],
    [3, "expense", "food", 265, "gcash", "b", "Merienda with the kids"],
    [3, "expense", "tithing", 3200, "maribank", "a", "Sunday service"],
    [4, "expense", "kids", 1450, "gcash", "b", "School project materials"],
    [5, "expense", "bills", 3120, "gcash", "a", "Electric bill"],
    [6, "expense", "groceries", 940, "cash", "b", "Palengke run"],
    [7, "expense", "leisure", 1680, "card", "a", "Family dinner out"],
    [8, "transfer", null, 5000, "maribank", "a", "Pay Atome", "card"],
    [9, "expense", "bills", 1699, "card", "a", "Internet"],
    [10, "expense", "padala", 3000, "gcash", "b", "Padala to Nanay"],
    [11, "expense", "health", 820, "cash", "b", "Vitamins & meds"],
    [12, "expense", "transport", 420, "gotyme", "a", "Ride home in the rain"],
    [13, "expense", "groceries", 2275, "card", "b", "Weekly groceries"],
    [14, "expense", "household", 1190, "gotyme", "b", "Detergent & cleaning stuff"],
    [15, "income", "salary", 32000, "maribank", "a", "Sahod, 2nd cutoff"],
    [15, "income", "business", 6400, "gcash", "b", "Online baking orders"],
    [16, "expense", "bills", 480, "gcash", "a", "Water bill"],
    [17, "expense", "food", 540, "cash", "a", "Lunch at work"],
    [18, "expense", "shopping", 2350, "card", "b", "School shoes"],
    [19, "expense", "groceries", 1120, "cash", "b", "Palengke run"],
    [20, "transfer", null, 2000, "maribank", "b", "Cash for the week", "cash"],
    [21, "expense", "kids", 600, "cash", "b", "Baon for the week"],
    [22, "expense", "food", 389, "gcash", "a", "Coffee & pandesal"],
    [23, "expense", "transport", 1500, "cash", "a", "Gas"],
    [24, "expense", "pet", 850, "gcash", "b", "Dog food"],
    [25, "expense", "other", 750, "cash", "a", "Barangay clearance & photocopies"],
    [26, "income", "gift", 2000, "gcash", "b", "Birthday money from Tita"],
    [27, "income", "bonus", 15000, "maribank", "a", "13th month, first half"],
    [28, "income", "other_in", 3500, "gotyme", "a", "Sold old phone"]
  ];
  S.demoTx = rows.map((r, i) => ({
    id: "demo" + i, type: r[1], amount: r[3], date: `${m}-${pad(day(r[0]))}`, cat: r[1] === "transfer" ? "transfer" : r[2],
    acct: r[4], to: r[7] || null, note: r[6], by: "demo-" + r[5], createdAt: Date.now() - (last - day(r[0])) * 86400000 - i * 600000, updatedAt: 0, updatedBy: null
  }));
  S.demoBudgets = { food: 4000, groceries: 9000, transport: 3000, bills: 21000, household: 2000, kids: 3500, health: 1500, shopping: 2500, leisure: 2000, padala: 3000, tithing: 6400, pet: 1200 };
}

// ---------- Rendering ----------
let pending = false, lastBanner = null, lastToast = "";
const toast = Object.assign(document.createElement("div"), { className: "toast", hidden: true });
toast.setAttribute("role", "status");
document.body.append(toast);
function draw() {
  const active = document.activeElement;
  if (active && active.closest && active.closest("#main input")) { pending = true; drawChrome(); return; }
  // Don't rebuild the list under a finger that's swiping an entry or an entry that's swiped open;
  // closeRow()/endSwipe() catch up afterwards.
  if (swipeBusy()) { pending = true; drawChrome(); return; }
  pending = false;
  drawChrome();
  const main = $("#main");
  const v = S.view;
  // Until the book has loaded, say so rather than showing empty months.
  if (!S.demo && !S.loaded) { main.innerHTML = openingScreen(); return; }
  main.dataset.tab = v; // lets styles.css size things per tab (not data-view: that marks the tab buttons)
  main.innerHTML = v === "stats" ? viewStats() : v === "budget" ? viewBudget() : v === "accounts" ? viewAccounts() : viewTrans();
  playAnims(main);
}
function paint() { draw(); refreshProfiles(); }

// ---------- When the book won't open ----------
// Two things can leave the app waiting forever without an error: the rest of the app's code failing to load
// (an old saved copy of the app right after an update) or Firestore's copy of the book on this phone getting
// stuck. So if opening fails, or is still going after 15 seconds, say so and offer a way out.
const STALL_MS = 15000;
function openingScreen() {
  if (!S.openTrouble) return `<div class="empty"><p>Opening your family book…</p></div>`;
  const failed = S.openTrouble === "failed";
  return `<div class="empty"><h2>${failed ? "Couldn't open your family book" : "This is taking a while"}</h2>
    <p>${failed ? "Something went wrong while opening AlkanSave." : "Your family book still hasn't opened."} Check that you're online, then reload.
      If that doesn't help, refresh AlkanSave on this phone: it downloads the app and your family's entries again. Nothing in the book is lost and you stay signed in.</p>
    <div class="banner-actions"><button class="btn primary" type="button" data-act="reload">Reload</button>
      <button class="btn" type="button" data-act="refresh-phone">Refresh AlkanSave on this phone</button></div></div>`;
}
// Clears this phone's saved copy of the app (service worker and its files) and Firestore's copy of the book,
// then reloads. Sign-in and entries saved "on this phone only" (localStorage) are kept.
async function refreshPhone() {
  try { for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister(); } catch {}
  try { for (const k of await caches.keys()) if (k.startsWith("alkansave-")) await caches.delete(k); } catch {}
  try {
    for (const d of await indexedDB.databases()) if (d.name && d.name.startsWith("firestore/")) indexedDB.deleteDatabase(d.name);
  } catch {}
  location.reload();
}

// ---------- Motion ----------
// Animations play only for things the person just did (switching tabs, opening a card), never for
// redraws caused by live updates, so the screen doesn't flicker when the family logs something.
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const animNext = new Set(); // what the next draw() should animate: "view", "prev", "next", "filters", "fold:<card>", "search"
function animate(...what) { if (!calm()) what.forEach(w => animNext.add(w)); }
function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}
// Grows a just-inserted element from zero height to its natural height.
function growOpen(el) {
  if (!el) return;
  const h = el.scrollHeight;
  Object.assign(el.style, { height: "0px", opacity: "0", overflow: "hidden" });
  void el.offsetWidth;
  Object.assign(el.style, { transition: "height .25s ease, opacity .25s ease", height: h + "px", opacity: "1" });
  setTimeout(() => Object.assign(el.style, { height: "", opacity: "", overflow: "", transition: "" }), 270);
}
// Folds an element down to zero height, then calls done() (which usually redraws without it).
function foldShut(el, done) {
  if (!el || calm()) { done(); return; }
  Object.assign(el.style, { height: el.offsetHeight + "px", overflow: "hidden" });
  void el.offsetWidth;
  Object.assign(el.style, { transition: "height .2s ease, opacity .2s ease", height: "0px", opacity: "0" });
  setTimeout(done, 210);
}
function playAnims(main) {
  if (!animNext.size) return;
  if (["view", "prev", "next"].some(k => animNext.has(k))) main.classList.remove("anim-view", "anim-prev", "anim-next"); // a quick second tap restarts cleanly
  if (animNext.has("view")) replay(main, "anim-view");
  if (animNext.has("prev")) replay(main, "anim-prev");
  if (animNext.has("next")) replay(main, "anim-next");
  if (animNext.has("filters")) growOpen(main.querySelector(".filters"));
  for (const w of animNext) if (w.startsWith("fold:")) growOpen(main.querySelector(`.fold-body[data-fold="${w.slice(5)}"]`));
  if (animNext.has("search")) replay(main.querySelector(".search"), "anim-grow");
  if (animNext.has("statcat")) growOpen(main.querySelector(".cat-tx"));
  animNext.clear();
}

function drawChrome() {
  $("#monthLabel").textContent = monthLabel(S.month);
  const mt = monthCounted();
  const inc = mt.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const exp = mt.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  $("#sum").innerHTML = `<div><span>Income</span><b class="num inc">${peso(inc)}</b></div><div><span>Expenses</span><b class="num exp">${peso(exp)}</b></div>
    <button type="button" class="sum-bal" data-act="bal-toggle" aria-expanded="${S.balOpen}" aria-controls="balBreak"><span>Balance<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span><b class="num">${peso(inc - exp)}</b></button>
    ${S.balOpen ? balanceBreakdown() : ""}`;

  const live = $("#live");
  const ls = S.demo ? "preview" : S.local ? "local" : S.live;
  live.dataset.s = ls;
  live.lastElementChild.textContent = { live: "Live", saving: "Saving…", connecting: "Connecting…", error: "Sync paused", preview: "Sample data", local: "Saved on this device", offline: "Offline · saved on phone" }[ls] || "Connecting…";

  // Your photo (initials until it loads, or if there isn't one) when signed in; redrawn only when it changes.
  const me = $("#me"), mine = S.user && S.meId && !S.demo ? S.profiles[S.meId] || {} : null;
  const meHtml = mine ? avatar(S.meId, false, mine.name || S.user.email) : "";
  if (me.dataset.html !== meHtml) { me.dataset.html = meHtml; me.innerHTML = meHtml; me.hidden = !meHtml; }

  // Short messages (entry added, deleted, hints) pop up near the bottom so they're seen wherever you've scrolled.
  const toastKey = S.notice + (S.undo ? "\u0000" + S.undoLabel : "") + (S.noticeBusy ? "\u0000busy" : "");
  if (toastKey !== lastToast) {
    lastToast = toastKey;
    toast.innerHTML = (S.noticeBusy ? `<span class="spin" aria-hidden="true"></span>` : "") + esc(S.notice)
      + (S.undo ? ` <button type="button" class="toast-undo" data-act="undo">${esc(S.undoLabel || "Undo")}</button>` : "");
    toast.hidden = !S.notice;
    if (S.notice) replay(toast, "anim-toast");
  }

  let b = "";
  if (S.demo) b = `<div class="banner"><span>You're looking at sample data. Nothing you add here is saved.</span><button type="button" data-act="exit-demo">Back to our book</button></div>`;
  else if (!S.canWrite) b = `<div class="banner warn"><span>View only. Ask the book's owner to make you an Editor so you can log entries.</span></div>`;
  else if (installOffer() && !installHintOff()) b = `<div class="banner">${installText()}<span class="banner-actions">${installOffer() === "prompt" ? `<button type="button" data-act="install">Install</button>` : ""}<button type="button" class="ghost" data-act="install-later">${installOffer() === "prompt" ? "Not now" : "Got it"}</button></span></div>`;
  // Only touch the banner when it changes, so it fades in once instead of on every redraw.
  if (b !== lastBanner) { lastBanner = b; $("#bannerWrap").innerHTML = b; replay($("#bannerWrap .banner"), "anim-fade"); }

  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.view === S.view || (t.dataset.view === "daily" && S.view === "calendar");
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  $("#fab").hidden = !(S.demo || S.canWrite);
}

// Under Balance: what the logged entries add up to in each account (starting balances not included), for the
// person on this phone: the shared Cash (everyone's entries), then only their own GCash, GoTyme, MariBank and
// PSBank (their own entries). Everyone else's accounts aren't shown, and neither is any account at ₱0.
// Atome and SPayLater are money owed, not on hand, so they aren't listed.
function balanceBreakdown() {
  const me = S.demo ? "demo-a" : S.meId || "local";
  const r2 = b => Math.round(b * 100) / 100;
  const cash = r2(flow(countedTx(), "cash"));
  const mine = [...PERSONAL_ACCOUNTS.filter(a => hasAccount(me, a) && !a.owed), ...OLD_ACCOUNTS] // not SPayLater: it's owed
    .map(a => ({ a, b: r2(personFlow(countedTx(), me, a.k)) })) // includes money your partner sent you
    .filter(r => r.b);
  const row = (a, b, tag) => `<div class="bb"><span class="nm">${acctIcon(a)}<span class="bb-n">${esc(a.n)}${tag ? `<span class="bb-tag">${tag}</span>` : ""}</span></span><b class="num ${b < 0 ? "exp" : "inc"}">${peso(b)}</b></div>`;
  const list = (cash ? row(acctOf("cash"), cash, "shared") : "") + mine.map(r => row(r.a, r.b)).join("");
  return `<div class="bal-break" id="balBreak">${list || `<p class="meta">Nothing in Cash or your accounts yet.</p>`}</div>`;
}

function familyCard() {
  const mt = monthCounted().filter(t => t.type === "expense");
  const ids = [...new Set([S.demo ? "demo-a" : S.meId, ...txAll().map(t => t.by)].filter(Boolean))];
  const spent = id => mt.filter(t => t.by === id).reduce((a, t) => a + t.amount, 0);
  const people = ids.length ? ids.map(id => `<div class="person">${avatar(id)}<span class="nm">${esc(who(id).name)}</span><span class="amt num">${peso(spent(id))}</span></div>`).join("") : `<span class="meta">People appear here once they log an entry.</span>`;
  const recent = [...txAll()].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).slice(0, 3);
  const act = recent.map(t => {
    const c = catOf(t.type, t.cat);
    const actor = t.updatedAt && t.updatedBy ? t.updatedBy : t.by;
    const verb = t.updatedAt ? "edited" : "added";
    return `<div><b>${esc(who(actor).name)}</b> ${verb} ${peso(t.amount)} ${esc(c.n.toLowerCase())} · ${ago(t.updatedAt || t.createdAt)}</div>`;
  }).join("");
  const alone = S.user && S.user.members().length <= 1;
  const hint = (!S.demo && S.isOwner && alone) ? `<div class="hint bar-row"><span>Add your family so they can log entries from their own phones.</span><button class="btn" type="button" data-act="invite">Invite family</button></div>` : "";
  return `<section class="family" aria-label="Family"><div class="family-h"><span class="label">Spent by each of you · ${esc(monthLabel(S.month))}</span></div><div class="people">${people}</div>${act ? `<div class="activity">${act}</div>` : ""}${hint}</section>`;
}

// One entry: category on the left, note (or category) with account and person underneath, amount on the right.
// Tapping the row opens its edit form; swiping it left uncovers Edit and Delete behind it (see "Swipe an entry"
// below). View-only members can't do either.
const EDIT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>`;
const TRASH_ICON = `<svg class="bin" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`;
const CHECK_ICON = `<svg class="ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
// After an entry's name in the list when it has photos attached (they show when it's opened).
const CLIP_ICON = `<svg class="tx-clip" viewBox="0 0 24 24" role="img" aria-label="Has a photo"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>`;
function txRow(t) {
  const c = catOf(t.type, t.cat);
  const acct = t.type === "transfer" ? `${acctOf(t.acct).n} → ${toName(t)}${acctOf(t.to).n}` : acctOf(t.acct).n;
  const cls = t.type === "income" ? "inc" : t.type === "expense" ? "exp" : "";
  const ro = !(S.demo || S.canWrite);
  const id = esc(t.id);
  return `<div class="tx-wrap${glowAttrs(t.id)}"${ro ? ` data-ro="1"` : ""}>
    ${ro ? "" : `<div class="tx-actions">
      <button type="button" class="tx-edit" data-act="edit" data-id="${id}" aria-label="Edit">${EDIT_ICON}</button>
      <button type="button" class="tx-del" data-act="tx-del" data-id="${id}" aria-label="Delete">${TRASH_ICON}${CHECK_ICON}</button>
    </div>`}
    <div class="tx">
      <span class="tx-cat"><span class="e" aria-hidden="true">${c.e}</span><span class="n">${esc(c.n)}</span></span>
      <span class="tx-main"><span class="tx-title"><span class="tx-t">${esc(t.note || c.n)}</span>${t.photos ? CLIP_ICON : ""}</span><span class="tx-sub">${isUpcoming(t) ? `<span class="soon">Upcoming</span> ` : ""}${esc(acct)} · ${esc(who(t.by).name)}</span></span>
      <span class="num tx-amt ${cls}">${peso(t.amount)}</span>
    </div>
  </div>`;
}
// showMonth: add "11.2026" next to the weekday when a list can span months (all-time search).
function dayGroup(date, list, showMonth) {
  const d = new Date(date + "T00:00:00");
  const wd = d.getDay();
  const inc = list.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const exp = list.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  return `<section class="day${date > todayISO() ? " later" : ""}"><div class="day-h">
    <span class="day-n num">${d.getDate()}</span>
    <span class="day-w"><span class="wd${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">${d.toLocaleDateString("en-PH", { weekday: "short" })}</span>${showMonth ? `<span class="my">${pad(d.getMonth() + 1)}.${d.getFullYear()}</span>` : ""}</span>
    <span class="num inc">${inc ? peso(inc) : ""}</span><span class="num exp">${exp ? peso(exp) : ""}</span>
  </div>${list.map(txRow).join("")}</section>`;
}

function viewTrans() {
  const n = filterCount();
  // One pill: Daily | Calendar | Filter. Filter opens the filter panel and shows how many filters are on.
  const hasTx = txAll().length > 0;
  const filter = hasTx
    ? `<button type="button" class="seg-filter${n ? " has" : ""}" data-act="filters" aria-pressed="${S.showFilters}" aria-expanded="${S.showFilters}">Filter${n ? ` · ${n}` : ""}</button>` : "";
  // Search is a small "Search" button until tapped (or while a search is typed), then a full-width box.
  const searching = S.searchOpen || !!S.q;
  const searchPill = hasTx && !searching
    ? `<button type="button" class="search-pill" data-act="search-open">${SEARCH_ICON}Search</button>` : "";
  const seg = `<div class="bar-row"><div class="seg view" role="group" aria-label="View"><button type="button" data-view="daily" aria-pressed="${S.view === "daily"}">Daily</button><button type="button" data-view="calendar" aria-pressed="${S.view === "calendar"}">Calendar</button>${filter}</div>${searchPill}</div>`;
  if (!S.demo && S.tx.length === 0) {
    return seg + `<div class="empty"><h2>Your family book is empty</h2><p>Tap + to log your first expense. ${S.local ? "Entries are saved on this device for now." : "Everyone in your family sees it on their phone right away."}</p><button class="btn" type="button" data-act="demo">Preview with sample data</button></div>` + familyCard();
  }
  const search = searching ? `<div class="search">${SEARCH_ICON}
    <input type="search" id="q" value="${esc(S.q)}" placeholder="Search notes, categories, people, amounts" autocomplete="off" enterkeyhint="search" aria-label="Search entries">
    <button type="button" class="link" data-act="search-close">Cancel</button></div>` : "";
  return seg + search + (S.showFilters ? filterPanel() : "") + `<div id="results">${transBody()}</div>`;
}
const SEARCH_ICON = `<svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`;

// ---------- Search and filters ----------
const filterCount = () => ["type", "cat", "who", "acct"].filter(k => S.f[k]).length + (S.f.scope === "all" ? 1 : 0);
const filtering = () => !!S.q.trim() || filterCount() > 0;

function filteredTx() {
  const F = S.f, q = S.q.trim().toLowerCase();
  const text = t => [t.note, catOf(t.type, t.cat).n, acctOf(t.acct).n, t.to ? acctOf(t.to).n : "", who(t.by).name, String(t.amount), peso(t.amount), t.date]
    .join(" ").toLowerCase();
  return (F.scope === "all" ? txAll() : monthTx()).filter(t =>
    (!F.type || t.type === F.type) && (!F.cat || t.cat === F.cat) && (!F.who || t.by === F.who)
    && (!F.acct || t.acct === F.acct || t.to === F.acct) && (!q || text(t).includes(q)));
}

function filterPanel() {
  const F = S.f;
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const people = [...new Set([S.demo ? "demo-a" : S.meId, ...txAll().map(t => t.by)].filter(Boolean))];
  return `<div class="filters">
    <label class="field"><span>Type</span><select data-filter="type">${opt("", "All types", F.type)}${opt("expense", "Expenses", F.type)}${opt("income", "Income", F.type)}${opt("transfer", "Transfers", F.type)}</select></label>
    <label class="field"><span>Category</span><select data-filter="cat">${opt("", "All categories", F.cat)}<optgroup label="Expenses">${CATS.expense.map(c => opt(c.k, c.n, F.cat)).join("")}</optgroup><optgroup label="Income">${CATS.income.map(c => opt(c.k, c.n, F.cat)).join("")}</optgroup></select></label>
    <label class="field"><span>Person</span><select data-filter="who">${opt("", "Everyone", F.who)}${people.map(id => opt(id, who(id).name, F.who)).join("")}</select></label>
    <label class="field"><span>Account</span><select data-filter="acct">${opt("", "All accounts", F.acct)}${ALL_ACCOUNTS.filter(a => ACCOUNTS.includes(a) || txAll().some(t => t.acct === a.k || t.to === a.k)).map(a => opt(a.k, a.n, F.acct)).join("")}</select></label>
    <div class="filters-foot"><div class="seg" role="group" aria-label="Period"><button type="button" data-act="scope" data-scope="month" aria-pressed="${F.scope === "month"}">${esc(monthLabel(S.month))}</button><button type="button" data-act="scope" data-scope="all" aria-pressed="${F.scope === "all"}">All time</button></div>
      ${filtering() ? `<button class="link" type="button" data-act="clear-filters">Clear all</button>` : ""}</div>
  </div>`;
}

function searchResults() {
  const list = filteredTx().sort(newestDayFirst);
  const where = S.f.scope === "all" ? "all time" : monthLabel(S.month);
  const q = S.q.trim();
  if (!list.length) {
    return `<div class="empty"><h2>No matching entries</h2><p>Nothing in ${esc(where)} matches ${q ? `“${esc(q)}”` : "these filters"}.</p>
      ${S.f.scope === "month" ? `<button class="btn" type="button" data-act="scope" data-scope="all">Search all time</button>` : ""}</div>`;
  }
  const now = list.filter(t => !isUpcoming(t)); // the totals leave out upcoming entries, like everywhere else
  const out = now.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  const inc = now.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const byDay = {};
  list.forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
  return `<section class="card result-sum"><span><b>${list.length}</b> ${list.length === 1 ? "entry" : "entries"} · ${esc(where)}</span>
    <span class="result-nums">${out ? `<span class="num exp">${peso(out)} spent</span>` : ""}${inc ? `<span class="num inc">${peso(inc)} in</span>` : ""}</span></section>`
    + Object.keys(byDay).map(d => dayGroup(d, byDay[d], S.f.scope === "all")).join("");
}

// Everything under the search box; re-rendered on its own while typing so the keyboard stays open.
function transBody() {
  if (filtering()) return searchResults();
  const mt = monthTx();
  let body;
  if (S.view === "calendar") body = calendar(mt);
  else if (!mt.length) body = `<div class="empty"><h2>Nothing logged in ${esc(monthLabel(S.month))}</h2><p>Tap + to add an entry for this month.</p></div>`;
  else {
    const byDay = {};
    [...mt].sort(newestDayFirst).forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
    // Days after today sit together at the top under "Upcoming", greyed: logged ahead, not counted yet.
    const today = todayISO(), days = Object.keys(byDay), later = days.filter(d => d > today), past = days.filter(d => d <= today);
    body = (later.length ? `<div class="later-box"><div class="later-h"><span class="label">Upcoming</span><span class="meta">Not counted until their day</span></div>${later.map(d => dayGroup(d, byDay[d])).join("")}</div>` : "")
      + past.map(d => dayGroup(d, byDay[d])).join("");
  }
  // The day's entries come first; the per-person summary sits below them.
  return body + familyCard();
}

function calendar(mt) {
  const [y, mo] = S.month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1).getDay(), n = daysIn(S.month), today = todayISO();
  if (S.selDay.slice(0, 7) !== S.month) S.selDay = today.slice(0, 7) === S.month ? today : `${S.month}-01`;
  let cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(w => `<div class="cal-wd">${w}</div>`).join("");
  for (let i = 0; i < first; i++) cells += `<span class="cell out" aria-hidden="true"></span>`;
  for (let d = 1; d <= n; d++) {
    const date = `${S.month}-${pad(d)}`;
    const list = mt.filter(t => t.date === date);
    const inc = list.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const exp = list.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
    cells += `<button type="button" class="cell${date === today ? " today" : ""}${date > today ? " later" : ""}" data-act="day" data-date="${date}" aria-pressed="${date === S.selDay}" aria-label="${d} ${esc(monthLabel(S.month))}${exp ? ", spent " + peso(exp) : ""}">
      <span class="d num">${d}</span>${inc ? `<span class="v num inc">${peso(inc)}</span>` : ""}${exp ? `<span class="v num exp">${peso(exp)}</span>` : ""}</button>`;
  }
  const trailing = (7 - ((first + n) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells += `<span class="cell out" aria-hidden="true"></span>`;
  const sel = mt.filter(t => t.date === S.selDay).sort((a, b) => posOf(a) - posOf(b));
  return `<div class="cal"><div class="cal-g">${cells}</div></div>` + (sel.length ? dayGroup(S.selDay, sel) : `<p class="meta">Nothing logged on ${new Date(S.selDay + "T00:00:00").toLocaleDateString("en-PH", { month: "long", day: "numeric" })}.</p>`);
}

// Donut of categories; each slice opens its category's entries (open: the category key shown, others fade).
function donut(parts, total, label, open) {
  const r = 64, C = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map(p => {
    const len = total ? (p.v / total) * C : 0;
    const s = `<circle class="seg-slice${open && open !== p.k ? " dim" : ""}" data-act="stat-cat" data-cat="${esc(p.k)}" cx="80" cy="80" r="${r}" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"/>`;
    off += len;
    return s;
  }).join("");
  return `<svg viewBox="0 0 160 160" role="img" aria-label="${esc(label)}"><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="22"/>${segs}
    <text x="80" y="76" text-anchor="middle" style="fill:var(--muted);font-family:var(--body)" font-size="11">Total</text>
    <text x="80" y="95" text-anchor="middle" style="fill:var(--ink)" font-size="16" class="donut-mid">${esc(peso(total))}</text></svg>`;
}

function viewStats() {
  const type = S.statType;
  const mt = monthCounted().filter(t => t.type === type);
  const total = mt.reduce((a, t) => a + t.amount, 0);
  const seg = `<div class="bar-row"><div class="seg" role="group" aria-label="Show"><button type="button" data-act="stat" data-type="expense" aria-pressed="${type === "expense"}">Expenses</button><button type="button" data-act="stat" data-type="income" aria-pressed="${type === "income"}">Income</button></div></div>`;
  if (!mt.length) return seg + `<div class="empty"><h2>No ${type === "expense" ? "expenses" : "income"} in ${esc(monthLabel(S.month))}</h2><p>Stats fill in as your family logs entries.</p></div>`;
  const byCat = {};
  mt.forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const parts = Object.entries(byCat).map(([k, v]) => ({ ...catOf(type, k), k, v })).sort((a, b) => b.v - a.v);
  const open = parts.some(p => p.k === S.statOpen) ? S.statOpen : null;
  // Each category opens to list its entries this month (newest first).
  const entries = k => mt.filter(t => t.cat === k).sort(newestDayFirst).map(t => {
    const d = new Date(t.date + "T00:00:00");
    const acct = t.type === "transfer" ? `${acctOf(t.acct).n} → ${toName(t)}${acctOf(t.to).n}` : acctOf(t.acct).n;
    return `<div class="ctx"><span class="ctx-d"><b>${d.getDate()}</b>${d.toLocaleDateString("en-PH", { weekday: "short" })}</span>
      <span class="ctx-m"><span class="t">${esc(t.note || catOf(t.type, t.cat).n)}</span><span class="s">${esc(acct)} · ${esc(who(t.by).name)}</span></span>
      <span class="num ${type === "income" ? "inc" : "exp"}">${peso(t.amount)}</span></div>`;
  }).join("");
  const legend = parts.map(p => `<button type="button" class="lg${open === p.k ? " open" : ""}" data-act="stat-cat" data-cat="${esc(p.k)}" aria-expanded="${open === p.k}" style="--c:${p.c};--ci:${inkOn(p.c)}">
      <span class="pct num">${Math.round(p.v / total * 100)}%</span><span class="n">${p.e} ${esc(p.n)}</span><span class="num">${peso(p.v)}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    ${open === p.k ? `<div class="cat-tx">${entries(p.k)}</div>` : ""}`).join("");
  const byWho = {};
  mt.forEach(t => { const k = t.by || "unknown"; byWho[k] = (byWho[k] || 0) + t.amount; });
  const max = Math.max(...Object.values(byWho));
  const whoRows = Object.entries(byWho).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<div class="who-row">${avatar(id === "unknown" ? null : id)}<span class="nm">${esc(who(id === "unknown" ? null : id).name)}</span><span class="num">${peso(v)}</span><div class="meter"><i style="width:${(v / max * 100).toFixed(1)}%;--c:${esc(who(id === "unknown" ? null : id).color)}"></i></div></div>`).join("");
  return seg + `<section class="card"><span class="label">By category</span><div class="donut-wrap">${donut(parts, total, `${type} by category`, open)}<div class="legend">${legend}</div></div>
    <p class="meta">Tap a category to see its entries.</p>
    ${S.demo ? "" : `<button class="link" type="button" data-act="demo">Preview with sample data</button>`}</section>
    <section class="card"><span class="label">${type === "expense" ? "Who spent" : "Who earned"} · ${esc(monthLabel(S.month))}</span>${whoRows}</section>`;
}

function viewBudget() {
  const lim = budgets();
  const mt = monthCounted().filter(t => t.type === "expense");
  const spent = k => mt.filter(t => t.cat === k).reduce((a, t) => a + t.amount, 0);
  const totalLim = Object.values(lim).reduce((a, v) => a + v, 0);
  const totalSpent = CATS.expense.filter(c => lim[c.k]).reduce((a, c) => a + spent(c.k), 0);
  const unbudgeted = mt.reduce((a, t) => a + t.amount, 0) - totalSpent;
  const editable = S.demo || S.canWrite;
  const state = (s, l) => { if (!l) return ""; const r = s / l; return r > 1 ? "st-over" : r >= 0.8 ? "st-warn" : "st-ok"; };
  const barColor = (s, l) => { const r = l ? s / l : 0; return r > 1 ? "var(--expense)" : r >= 0.8 ? "var(--warn)" : "var(--ok)"; };
  const tPct = totalLim ? Math.min(100, totalSpent / totalLim * 100) : 0;
  const head = `<section class="card bud-total"><span class="label">Monthly budget · ${esc(monthLabel(S.month))}</span>
    ${totalLim ? `<div class="bar-row"><span class="big num">${peso(totalSpent)} <span class="meta">of ${peso(totalLim)}</span></span><span class="${state(totalSpent, totalLim)} num">${totalSpent > totalLim ? peso(totalSpent - totalLim) + " over" : peso(totalLim - totalSpent) + " left"}</span></div>
    <div class="meter"><i style="width:${tPct.toFixed(1)}%;--c:${barColor(totalSpent, totalLim)}"></i></div>
    ${unbudgeted > 0 ? `<span class="meta">${peso(unbudgeted)} spent in categories without a budget.</span>` : ""}`
    : `<p class="meta">Set a monthly limit for the categories you want to watch. Limits repeat every month and everyone in the family sees the same numbers.</p>`}</section>`;
  const rows = CATS.expense.map(c => {
    const s = spent(c.k), l = lim[c.k] || 0;
    const pct = l ? Math.min(100, s / l * 100) : 0;
    // One compact row: icon | name, "spent · left" and the bar | limit box (centred on the right).
    const foot = l
      ? `<span class="num">${peso(s)} spent</span> · <span class="${state(s, l)} num">${s > l ? peso(s - l) + " over" : peso(l - s) + " left"}</span>`
      : `<span class="num">${s ? peso(s) + " spent" : "No spending yet"}</span> · No limit`;
    return `<div class="bud"><span class="ico" style="--c:${c.c}" aria-hidden="true">${c.e}</span>
      <div class="bud-body"><span class="nm">${esc(c.n)}</span><div class="bud-foot">${foot}</div>
        ${l ? `<div class="meter"><i style="width:${pct.toFixed(1)}%;--c:${barColor(s, l)}"></i></div>` : ""}</div>
      <label class="limit"><span>₱</span><input id="lim-${c.k}" data-lim="${c.k}" inputmode="numeric" value="${grouped(l)}" placeholder="No limit" aria-label="Monthly limit for ${esc(c.n)}"${editable ? "" : " disabled"}></label></div>`;
  }).join("");
  return head + `<section class="card"><div class="row-list">${rows}</div></section>` + recurringSection() + reminderSection();
}

// ---------- Bill reminders ----------
// Sent by api/reminders.js at 8 AM the day before a recurring expense is due, or an expense logged ahead.
const REMINDER_TIME = "8 AM";
const dayBefore = iso => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Upcoming one-time expenses that get a reminder (not ones a repeating bill added: that bill has its own).
const aheadExpenses = () => txAll().filter(t => t.type === "expense" && isUpcoming(t) && !(t.id || "").startsWith("r_"));
function nextReminder() {
  const today = todayISO();
  let best = null;
  const consider = (due, r) => { const remind = dayBefore(due); if (remind > today && (!best || remind < best.remind)) best = { remind, due, r }; return remind > today; };
  for (const r of S.recurring) {
    if (!r.active || r.type !== "expense") continue;
    for (const m of [today.slice(0, 7), shiftMonth(today.slice(0, 7), 1)]) if (consider(dueDate(r, m), r)) break;
  }
  for (const t of aheadExpenses()) consider(t.date, t);
  return best;
}
function reminderSection() {
  if (S.demo || !S.user || !S.rem || S.rem === "unavailable") return "";
  const bills = S.recurring.filter(r => r.active && r.type === "expense").length + aheadExpenses().length;
  const day = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  const msg = {
    "needs-install": `On iPhone, reminders only work in the installed app. Tap ${SHARE_ICON} <b>Share</b> → <b>Add to Home Screen</b>, open AlkanSave from your Home Screen, and turn them on there.`,
    unsupported: "This browser can't show reminders. Open AlkanSave in Chrome, or install it to your Home Screen.",
    denied: "Notifications are blocked for AlkanSave on this phone. Allow them in your phone's settings for this app (or the browser's site settings), then reopen AlkanSave.",
    off: `Get a notification at ${REMINDER_TIME} the day before each repeating bill, or expense you log ahead, is due.`,
    on: `On for this phone. You'll get a notification at ${REMINDER_TIME} the day before each repeating bill, or expense you log ahead, is due.`
  }[S.rem] || "";
  const next = S.rem === "on" && nextReminder();
  const none = (S.rem === "on" || S.rem === "off") && !bills;
  const button = S.rem === "off" ? `<button class="btn primary" type="button" data-act="rem-on"${S.remBusy ? " disabled" : ""}>${S.remBusy ? "Turning on…" : "Turn on reminders"}</button>`
    : S.rem === "on" ? `<button class="btn" type="button" data-act="rem-off"${S.remBusy ? " disabled" : ""}>Turn off</button>` : "";
  return `<section class="card"><span class="label">Bill reminders${S.rem === "on" ? " · On" : ""}</span>
    <p class="meta">${msg}</p>
    ${next ? `<p class="meta">Next: <b>${day(next.remind)}</b>, for ${esc(next.r.note || catOf("expense", next.r.cat).n)} (due ${day(next.due)}).</p>` : ""}
    ${none ? `<p class="meta">Reminders are for bills set to repeat every month, and expenses you log for a later date. Tick <b>Repeat every month</b> when you log rent, Meralco or internet.</p>` : ""}
    ${button ? `<div>${button}</div>` : ""}</section>`;
}
async function turnOnReminders() {
  // Ask right away, inside the tap: iPhones only show the permission prompt in direct response to a tap.
  const permission = "Notification" in window ? Notification.requestPermission() : Promise.resolve("denied");
  S.remBusy = true; draw();
  try {
    S.rem = await S.user.reminders.enable(permission);
    flash(S.rem === "on" ? `Bill reminders are on for this phone.` : S.rem === "denied" ? "Notifications were blocked, so reminders can't be shown." : "Reminders weren't turned on.");
  } catch (x) {
    console.warn("AlkanSave reminders:", x);
    flash("Couldn't turn on reminders. Check your connection and try again.");
  }
  S.remBusy = false; draw();
}
async function turnOffReminders() {
  S.remBusy = true; draw();
  try { S.rem = await S.user.reminders.disable(); flash("Bill reminders are off for this phone."); }
  catch { flash("Couldn't turn off reminders. Check your connection and try again."); }
  S.remBusy = false; draw();
}

function recurringSection() {
  if (S.demo) return "";
  const list = S.recurring.filter(r => r.active).sort((a, b) => dueDate(a, S.month).localeCompare(dueDate(b, S.month)));
  const rows = list.map(r => {
    const c = catOf(r.type, r.cat);
    return `<button class="rec" type="button" data-act="rec-edit" data-id="${esc(r.id)}"${S.canWrite ? "" : " disabled"}>
      <span class="ico" style="--c:${c.c}" aria-hidden="true">${c.e}</span>
      <span class="rec-main"><span class="nm">${esc(r.note || c.n)}</span><span class="sub">${esc(c.n)} · ${repeatLabel(r)} of each month · ${esc(acctOf(r.acct).n)}</span></span>
      <span class="num ${r.type === "income" ? "inc" : "exp"}">${peso(r.amount)}</span></button>`;
  }).join("");
  return `<section class="card"><span class="label">Recurring every month</span>
    ${rows ? `<div class="row-list">${rows}</div>` : `<p class="meta">Rent, Meralco, internet or a salary can add themselves every month. When you log one, tick <b>Repeat every month</b>.</p>`}
    ${rows ? `<p class="meta">Each is added automatically on its day. ${S.canWrite ? "Tap one to change its amount or day, or to stop it." : ""}</p>` : ""}</section>`;
}

// ---------- Accounts: each family member's own GCash, GoTyme, MariBank and PSBank (and SPayLater), plus the shared Cash and Atome ----------
// People whose accounts are shown: everyone in the book (you first), plus anyone who logged entries before leaving.
function accountOwners() {
  if (S.demo) return ["demo-a", "demo-b"];
  if (!S.user) return [S.meId || "local"];
  const ids = S.user.members().map(m => m.id);
  for (const t of S.tx) if (t.by && !ids.includes(t.by)) ids.push(t.by);
  return ids.sort((a, b) => (b === S.meId) - (a === S.meId));
}
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const SHARED_KEYS = SHARED_ACCOUNTS.map(a => a.k);

// Starting balances of the shared Cash and Atome (config/shared). Until someone sets them, the Cash
// and card amounts saved before accounts were split (config/accounts) are used.
function sharedStarts() {
  if (S.demo) return {};
  if (S.sharedStart) return S.sharedStart;
  return Object.fromEntries(Object.entries(S.legacyStart).filter(([k]) => SHARED_KEYS.includes(k)));
}
// A person's own starting balances live on their member record (without sign-in, in this browser).
// Amounts saved before accounts were per person count for whoever entered them, until they save their own.
function startsOf(owner) {
  if (S.demo) return {};
  if (!S.user) return without(S.legacyStart, SHARED_KEYS);
  const m = S.user.members().find(x => x.id === owner);
  if (m && m.start && typeof m.start === "object") return without(cleanStarts(m.start), SHARED_KEYS);
  return owner === S.legacyStartBy ? without(S.legacyStart, SHARED_KEYS) : {};
}
// Money in and out of account k across a list of entries.
const flow = (list, k) => list.reduce((a, t) => {
  if (t.type === "income" && t.acct === k) return a + t.amount;
  if (t.type === "expense" && t.acct === k) return a - t.amount;
  if (t.type === "transfer") { if (t.acct === k) a -= t.amount; if (t.to === k) a += t.amount; }
  return a;
}, 0);
// Shared accounts: everyone's entries count.
function sharedBalances() {
  const st = sharedStarts();
  return SHARED_ACCOUNTS.map(a => ({ ...a, b: (st[a.k] || 0) + flow(countedTx(), a.k) }));
}
// PSBank and Deel belong only to the book's owner: everyone else gets "—" in that row, and doesn't see them
// when setting starting balances or logging entries. Without sign-in, the one person on this phone has them all.
function hasAccount(owner, a) {
  if (!a.ownerOnly) return true;
  if (S.demo) return owner === "demo-a";
  if (!S.user) return true;
  const m = S.user.members().find(x => x.id === owner);
  return !!m && m.role === "owner";
}
// Who a transfer's money went to: the person it was sent to ("toWho"), or whoever logged it (between their own accounts).
const receiver = t => t.toWho || t.by;
// Money in and out of a person's own account k: the entries they logged, plus transfers others sent them.
// Their transfer to someone else takes money out of their account but puts it into the other person's.
const personFlow = (list, owner, k) => list.reduce((a, t) => {
  const mine = t.by === owner;
  if (mine && t.type === "income" && t.acct === k) return a + t.amount;
  if (mine && t.type === "expense" && t.acct === k) return a - t.amount;
  if (t.type === "transfer") {
    if (mine && t.acct === k) a -= t.amount;
    if (t.to === k && receiver(t) === owner) a += t.amount;
  }
  return a;
}, 0);
// A person's balance in one of their own accounts: their starting amount plus their entries and transfers to them.
function personalBalance(owner, k) {
  return (startsOf(owner)[k] || 0) + personFlow(countedTx(), owner, k);
}
const SHARED_BADGE = `<span class="av shared-av" aria-hidden="true">👪</span>`;
// Column heading: first name ("You" before a name is known).
const firstName = o => {
  const p = S.profiles[o];
  const name = S.demo || !S.user ? who(o).name : (p && p.name) || who(o).name;
  return name.trim().split(/\s+/)[0];
};

// Balances side by side: one row per account, one column per person, and a family total.
// Personal accounts first (plus old Maya/Bank while anyone still has money in them), then the shared ones.
function viewAccounts() {
  const owners = accountOwners();
  const cls = b => b < 0 ? "exp" : b > 0 ? "inc" : "";
  const money = b => `<span class="num ${cls(b)}">${b ? peso(b) : "₱0"}</span>`;
  const accts = [...PERSONAL_ACCOUNTS, ...OLD_ACCOUNTS.filter(a => owners.some(o => personalBalance(o, a.k)))];
  const grid = accts.map(a => ({ a, cells: owners.map(o => personalBalance(o, a.k)) }));
  const shared = sharedBalances();
  const values = grid.flatMap(r => r.cells).concat(shared.map(r => r.b));
  const assets = values.filter(b => b > 0).reduce((s, b) => s + b, 0);
  const liab = values.filter(b => b < 0).reduce((s, b) => s + b, 0);
  const ownerNets = owners.map((_, i) => grid.reduce((s, r) => s + r.cells[i], 0));
  const name = a => `<th scope="row"><span class="acct-name">${acctIcon(a)}<span>${esc(a.n)}</span></span></th>`;
  // Rows in the order of the account list: Cash, GCash, GoTyme, MariBank, PSBank, SPayLater, (old accounts), Atome.
  // Shared accounts have one family amount, shown in Total.
  // "—" for someone who doesn't have the account (PSBank, SPayLater and Deel are only the owner's), unless money somehow shows up there.
  const NONE = `<span class="num none">—</span>`;
  // Your own MariBank amount is a button: tap it to log the interest it's earned (see "Bank interest").
  const me = S.demo ? "demo-a" : S.meId || "local";
  const cell = (o, a, b, show) => a.k === INTEREST_ACCOUNT && o === me && (S.demo || S.canWrite)
    ? `<td class="pc"><button type="button" class="bal-tap" data-act="interest" aria-label="Add ${esc(a.n)} interest">${show(b)}</button></td>`
    : `<td class="pc">${hasAccount(o, a) || b ? show(b) : NONE}</td>`;
  const personalRow = r => `<tr>${name(r.a)}${r.cells.map((b, i) => cell(owners[i], r.a, b, money)).join("")}<td class="tot">${money(r.cells.reduce((s, b) => s + b, 0))}</td></tr>`;
  const sharedRow = r => `<tr>${name(r)}<td colspan="${owners.length}" class="shared-cell">shared</td><td class="tot">${money(r.b)}</td></tr>`;
  const sharedOf = k => shared.find(r => r.k === k);
  const tableRows = [
    sharedRow(sharedOf("cash")),
    ...grid.map(personalRow),
    sharedRow(sharedOf("card"))
  ].join("");

  // Each person's Deel balance in dollars, below Net and outside every total above.
  const deel = owners.map(o => startsOf(o).deel || 0);
  const deelRow = `<tr class="usd">${name(DEEL)}${deel.map((b, i) => cell(owners[i], DEEL, b, v => `<span class="num">${usd(v)}</span>`)).join("")}<td class="tot"><span class="num">${usd(deel.reduce((s, b) => s + b, 0))}</span></td></tr>`;

  const table = `<div class="bal-wrap"><table class="bal-table">
    <thead><tr><th scope="col"><span class="sr-only">Account</span></th>${owners.map(o => `<th scope="col" class="pc"><span class="who-col">${avatar(o)}<span>${esc(firstName(o))}</span></span></th>`).join("")}<th scope="col">Total</th></tr></thead>
    <tbody>${tableRows}</tbody>
    <tfoot><tr><th scope="row">Net</th>${ownerNets.map(b => `<td class="pc">${money(b)}</td>`).join("")}<td class="tot">${money(assets + liab)}</td></tr>
      ${deelRow}</tfoot>
  </table></div>
  <p class="meta">Deel is in US dollars and isn't included in the totals.</p>`;

  return `<section class="card"><div class="acct-sum"><div><span>Assets</span><b class="num inc">${peso(assets)}</b></div><div><span>Owed</span><b class="num exp">${peso(-liab)}</b></div><div><span>Net</span><b class="num">${peso(assets + liab)}</b></div></div></section>
    <section class="card"><span class="label">Balances</span>${table}</section>`
    + startSection() + familySection() + exportSection() + installSection();
}

// Cards on Accounts that fold down to just their heading (Starting balances, Family). They start folded;
// opening or closing one is remembered on this phone.
const FOLDS = { starts: "alkansave.showStarts", family: "alkansave.showFamily" };
const foldOpen = k => { try { return localStorage.getItem(FOLDS[k]) === "1"; } catch { return false; } };
const setFoldOpen = (k, on) => { try { localStorage.setItem(FOLDS[k], on ? "1" : "0"); } catch {} };
// The whole heading is the toggle; the arrow points down when folded and up when open.
const foldHead = (k, label) => `<button type="button" class="card-head fold" data-act="fold" data-fold="${k}" aria-expanded="${foldOpen(k)}"><span class="label">${label}</span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;

// What each account held before the family started logging. Anyone who can edit sets the shared Cash and
// Atome; everyone sets their own GCash, GoTyme, MariBank and PSBank (and SPayLater). Atome and SPayLater are entered as the amount owed.
function startSection() {
  if (S.demo) return "";
  const head = foldHead("starts", "Starting balances");
  if (!foldOpen("starts")) return `<section class="card">${head}</section>`;
  const row = (a, st, editable, attr) => {
    const owed = !!a.owed;
    const v = st[a.k] ? (owed ? -st[a.k] : st[a.k]) : 0;
    const value = editable
      ? `<label class="limit"><span>₱</span><input ${attr}="${a.k}" inputmode="decimal" value="${grouped(v)}" placeholder="0" aria-label="Starting ${owed ? "amount owed on" : "balance of"} ${esc(a.n)}"></label>`
      : `<span class="num muted-num">${v ? peso(v) : "—"}</span>`;
    return `<div class="acct">${acctIcon(a)}<div><div class="nm">${esc(a.n)}</div><div class="sub">${owed ? "Owed when you started" : "Had when you started"}</div></div>${value}</div>`;
  };
  const shared = `<div class="acct-owner">${SHARED_BADGE}<span class="nm">Shared</span></div>`
    + SHARED_ACCOUNTS.map(a => row(a, sharedStarts(), S.canWrite, "data-start-shared")).join("");
  // Only your own personal accounts here; everyone else sets (and sees) theirs on their own phone.
  const me = S.meId || "local";
  const mine = `<div class="acct-owner">${avatar(me)}<span class="nm">Your accounts</span></div>`
    + PERSONAL_ACCOUNTS.filter(a => hasAccount(me, a)).map(a => row(a, startsOf(me), true, "data-start")).join("")
    + (!hasAccount(me, DEEL) ? "" : `<div class="acct">${acctIcon(DEEL)}<div><div class="nm">Deel</div><div class="sub">Your balance now, in US dollars</div></div><label class="limit"><span>$</span><input data-start="deel" inputmode="decimal" value="${grouped(startsOf(me).deel)}" placeholder="0" aria-label="Deel balance in US dollars"></label></div>`);
  return `<section class="card">${head}<div class="fold-body" data-fold="starts">
    <p class="meta">What was already in each account before you started logging. The shared Cash and Atome are for the whole family; your other accounts are just yours. For Atome and SPayLater, enter what you owed.</p>${shared}${mine}</div></section>`;
}

function exportSection() {
  if (S.demo || !txAll().length) return "";
  return `<section class="card"><span class="label">Export</span>
    <p class="meta">Download entries as a CSV file for Excel or Google Sheets.</p>
    <div class="bar-row"><button class="btn" type="button" data-act="csv" data-scope="month">${esc(monthLabel(S.month))}</button><button class="btn" type="button" data-act="csv" data-scope="all">All entries</button></div></section>`;
}

function downloadCsv(scope) {
  const rows = (scope === "month" ? monthTx() : txAll()).slice().sort((a, b) => a.date.localeCompare(b.date) || posOf(a) - posOf(b));
  if (!rows.length) { flash(`Nothing logged in ${monthLabel(S.month)} yet.`); return; }
  // Quote text, and stop spreadsheet apps from treating a note like "=SUM(...)" as a formula.
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const name = id => (id && S.profiles[id] && S.profiles[id].name) || who(id).name;
  const lines = [["Date", "Type", "Category", "Amount (PHP)", "Account", "To account", "To person", "Note", "Logged by"].join(",")];
  for (const t of rows) {
    lines.push([
      t.date, t.type[0].toUpperCase() + t.type.slice(1), cell(catOf(t.type, t.cat).n), t.amount.toFixed(2),
      cell(acctOf(t.acct).n), t.type === "transfer" ? cell(acctOf(t.to).n) : "", t.type === "transfer" ? cell(name(receiver(t))) : "", cell(t.note), cell(name(t.by))
    ].join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `alkansave-${scope === "month" ? S.month : "all"}-${todayISO()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Install as an app ----------
const SHARE_ICON = `<svg class="share-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>`;
let installEvent = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; draw(); });
window.addEventListener("appinstalled", () => { installEvent = null; draw(); });
function installOffer() {
  if (isStandalone()) return "";
  return installEvent ? "prompt" : isIOS ? "ios" : "";
}
const installHintOff = () => { try { return localStorage.getItem("alkansave.installHint") === "off"; } catch { return false; } };
function installText() {
  return installOffer() === "ios"
    ? `<span>Install AlkanSave on your iPhone: tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>.</span>`
    : `<span>Install AlkanSave on this phone. It opens in one tap, even offline.</span>`;
}
function installSection() {
  if (S.demo || !installOffer()) return "";
  return `<section class="card"><span class="label">App</span>${installText()}
    ${installOffer() === "prompt" ? `<div><button class="btn primary" type="button" data-act="install">Install AlkanSave</button></div>` : ""}</section>`;
}
async function install() {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch {}
  installEvent = null;
  draw();
}

function familySection() {
  if (S.demo) return "";
  if (!S.user) {
    return S.canSignIn ? `<section class="card"><span class="label">Family</span>
      <p class="meta">Entries are saved on this phone only. Sign in to share one book with your family, live on each of your phones.</p>
      <div><button class="btn primary" type="button" data-act="signin">Sign in to share with family</button></div></section>` : "";
  }
  const roleName = { owner: "Owner", editor: "Editor", viewer: "View only" };
  const order = { owner: 0, editor: 1, viewer: 2 };
  const rows = S.user.members().sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3)).map(m => {
    // The owner can switch others between Editor and View only, or remove them (tap twice).
    const manage = S.isOwner && m.id !== S.meId && m.role !== "owner";
    const armed = S.armed === "remove:" + m.id;
    const role = manage
      ? `<select class="role" data-role="${esc(m.id)}" aria-label="Role for ${esc(who(m.id).name)}"><option value="editor"${m.role === "editor" ? " selected" : ""}>Editor</option><option value="viewer"${m.role === "viewer" ? " selected" : ""}>View only</option></select>
         <button class="btn sm danger${armed ? " armed" : ""}" type="button" data-act="member-remove" data-id="${esc(m.id)}">${armed ? "Tap to remove" : "Remove"}</button>`
      : `<span class="meta">${roleName[m.role] || ""}</span>`;
    return `<div class="member${manage ? " manage" : ""}">${avatar(m.id)}<span class="nm">${esc(who(m.id).name)}</span>${role}</div>`;
  }).join("");
  const leaveArmed = S.armed === "leave";
  const head = foldHead("family", `Family · ${esc(S.user.household().name)}`);
  if (!foldOpen("family")) return `<section class="card">${head}</section>`;
  return `<section class="card">${head}<div class="fold-body" data-fold="family">${rows}
    ${S.isOwner ? `<div><button class="btn primary" type="button" data-act="invite">Invite family</button></div>`
      : `<p class="meta">Editors can add and change entries. View only members can look but not change anything.</p>`}
    <div class="bar-row"><span class="meta">Signed in as ${esc(S.user.email)}</span><span class="banner-actions">
      ${S.isOwner ? "" : `<button class="btn danger${leaveArmed ? " armed" : ""}" type="button" data-act="leave">${leaveArmed ? "Tap to leave" : "Leave book"}</button>`}
      <button class="btn" type="button" data-act="signout">Sign out</button></span></div></div></section>`;
}

// ---------- Entry sheet ----------
const sheet = $("#sheet");

// ---------- Transfer to a family member ----------
// A transfer's To picker: the person who logs it ("Me" when that's you) or another family member. Sending to
// someone else lists only their own accounts, not the shared Cash and Atome (money put there wouldn't be theirs).
// It's saved as the entry's "toWho" and counted in that person's balances (see personFlow).
let toSender = null, toWho = null; // who logged the transfer, and who gets the money
const meNow = () => S.demo ? "demo-a" : S.meId || "local";
const toName = (t, receiverId = receiver(t)) => receiverId !== t.by ? `${firstName(receiverId)}'s ` : ""; // "Shaira's " or ""
function renderToWho() {
  const box = $("#f-towho"), people = accountOwners();
  if (!people.includes(toWho)) people.push(toWho); // someone who has left the family
  box.hidden = people.length < 2;
  box.innerHTML = people.map(id => `<button type="button" role="radio" data-act="to-who" data-who="${esc(id)}" aria-checked="${id === toWho}">${avatar(id, true)}<span>${id === meNow() ? "Me" : esc(firstName(id))}</span></button>`).join("");
  fillTo();
}
function fillTo() {
  const sel = $("#f-to"), keep = sel.value, other = toWho !== toSender;
  sel.innerHTML = ACCOUNTS.filter(a => hasAccount(toWho, a) && !(other && a.shared)).map(a => `<option value="${a.k}">${esc(a.n)}</option>`).join("");
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}
// ---------- Logging an entry for a family member ----------
// A new entry's For picker: Me, or another family member (e.g. Shaira paid from her GCash and asked you to log it).
// It's saved as theirs ("by": it counts in their balances and spending) with "loggedBy" saying you entered it.
// Picking them lists their accounts, makes them the sender of a transfer, and hides Repeat every month (a repeating
// bill belongs to whoever sets it up). Only for new entries: an entry's owner doesn't change when it's edited.
let forWho = null; // whose new entry this is
const forOther = () => forWho !== meNow();
function renderFor() {
  const people = accountOwners();
  $("#forWrap").hidden = !!S.editing || !!S.editingRec || people.length < 2 || !(S.demo || S.canWrite);
  $("#f-for").innerHTML = people.map(id => `<button type="button" role="radio" data-act="for-who" data-who="${esc(id)}" aria-checked="${id === forWho}">${avatar(id, true)}<span>${id === meNow() ? "Me" : esc(firstName(id))}</span></button>`).join("");
}
function applyFor() {
  const sel = $("#f-acct"), keep = sel.value;
  fillAccounts();
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  if (toWho === toSender) toWho = forWho; // a transfer between their own accounts stays that way
  toSender = forWho;
  renderToWho();
  setType(sheet.dataset.type); // shows or hides Repeat every month
  $("#f-for").querySelectorAll("[data-who]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.who === forWho)));
}
function fillAccounts() {
  const me = forWho || meNow(); // the accounts of whoever the entry is for
  const opts = ACCOUNTS.filter(a => hasAccount(me, a)).map(a => `<option value="${a.k}">${esc(a.n)}</option>`).join("");
  $("#f-acct").innerHTML = opts; $("#f-to").innerHTML = opts;
  $("#f-day").innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${repeatLabel({ day: i + 1 })}</option>`).join("");
  $("#f-week").innerHTML = WEEKS.map((w, i) => `<option value="${i + 1}">${w[0].toUpperCase() + w.slice(1)}</option>`).join("");
  $("#f-weekday").innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}">${WEEKDAYS[d]}</option>`).join(""); // Monday first
}

// ---------- Repeating: on a date or a weekday ----------
// New entry: "Repeat every month" offers the ways its date can repeat ("the 3rd", "the first Tuesday", …).
const capital = s => s[0].toUpperCase() + s.slice(1);
function syncRepeat() {
  const wrap = $("#repWhenWrap"), sel = $("#f-rep");
  wrap.hidden = $("#repeatWrap").hidden || !$("#f-repeat").checked;
  const date = $("#f-date").value;
  if (wrap.hidden || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  // Keep the kind of choice (date, nth weekday, last weekday) when the date changes, if it still fits.
  const kind = p => !p ? "" : p.week === 5 ? "last" : p.week ? "nth" : "date";
  const was = kind(patternsFor(sel.dataset.date || date)[Number(sel.value)]);
  const list = patternsFor(date);
  sel.innerHTML = list.map((p, i) => `<option value="${i}">${capital(`the ${repeatLabel(p)} of each month`)}</option>`).join("");
  const at = k => list.findIndex(p => kind(p) === k);
  sel.value = String(Math.max(0, at(was) >= 0 ? at(was) : was === "last" ? at("nth") : 0));
  sel.dataset.date = date;
}
const chosenPattern = () => patternsFor($("#f-date").value)[Number($("#f-rep").value)] || { day: Number($("#f-date").value.slice(8)) };
// Editing a recurring item: "A date" shows the day picker, "A weekday" shows First…Last and Monday…Sunday.
function syncRepBy() {
  const wk = $("#f-rep-by").value === "weekday";
  $("#f-day").hidden = wk; $("#f-week").hidden = !wk; $("#f-weekday").hidden = !wk;
}
// Selects an account, adding an old one (Maya, Bank) just for this entry so editing it doesn't switch accounts.
function pickAccount(sel, k) {
  if (k && ![...sel.options].some(o => o.value === k)) sel.add(new Option(acctOf(k).n, k));
  sel.value = k;
}
function renderCats(type, sel) {
  const list = CATS[type] || [];
  $("#f-cats").innerHTML = list.map(c => `<input type="radio" name="cat" id="cat-${c.k}" value="${c.k}"${c.k === sel ? " checked" : ""}><label for="cat-${c.k}" style="--c:${c.c}"><span class="e" aria-hidden="true">${c.e}</span>${esc(c.n)}</label>`).join("");
  updateCatToggle();
  showCats(false);
}
// The category grid stays folded behind one "Category" field until it's tapped; picking one folds it again.
function updateCatToggle() {
  const sel = sheet.querySelector('input[name="cat"]:checked');
  const c = sel && (CATS[sheet.dataset.type] || []).find(x => x.k === sel.value);
  $("#catToggle").innerHTML = (c ? `<span class="pick"><span class="e" aria-hidden="true">${c.e}</span>${esc(c.n)}</span>` : `<span class="ph">Choose a category</span>`)
    + `<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
}
function showCats(open) {
  $("#f-cats").hidden = !open;
  $("#catToggle").setAttribute("aria-expanded", String(open));
}
function setType(type, sel) {
  sheet.dataset.type = type;
  $("#t-" + type).checked = true;
  const tr = type === "transfer";
  $("#catWrap").hidden = tr; $("#toWrap").hidden = !tr;
  $("#acctLabel").textContent = tr ? "From account" : "Account";
  $("#repeatWrap").hidden = tr || !!S.editing || !!S.editingRec || S.demo || forOther();
  if ($("#repeatWrap").hidden) $("#f-repeat").checked = false;
  syncRepeat();
  const keepCat = sel === undefined && sheet.querySelector('input[name="cat"]:checked'); // re-run (For changed): keep the category
  if (!tr) renderCats(type, keepCat ? keepCat.value : sel); // no default: a new entry starts with "Choose a category"
}
// The sheet edits either an entry (date) or a recurring item (when it repeats; no transfers).
function setSheetMode(rec) {
  sheet.dataset.mode = rec ? "rec" : "entry";
  $("#dateWrap").hidden = rec; $("#dayWrap").hidden = !rec;
}
function openSheet(t) {
  S.editing = t ? t.id : null; S.editingRec = null; S.delArmed = false;
  setSheetMode(false);
  $("#sheetTitle").textContent = t ? "Edit entry" : "New entry";
  $("#f-err").textContent = "";
  const del = $("#f-del"); del.hidden = !t; del.classList.remove("armed"); del.textContent = "Delete";
  const today = todayISO();
  const defDate = S.view === "calendar" ? S.selDay : (today.slice(0, 7) === S.month ? today : `${S.month}-01`);
  $("#f-repeat").checked = false;
  $("#f-rep").dataset.date = "";
  forWho = t ? t.by : meNow();
  renderFor();
  setType(t ? t.type : "expense", t ? t.cat : null);
  $("#f-amount").value = t ? grouped(t.amount) : "";
  $("#f-date").value = t ? t.date : defDate;
  fillAccounts();
  pickAccount($("#f-acct"), t ? t.acct : "cash");
  toSender = t ? t.by : meNow();
  toWho = t && t.toWho ? t.toWho : toSender;
  renderToWho();
  pickAccount($("#f-to"), t && t.to ? t.to : "maribank");
  $("#f-note").value = t ? t.note : "";
  const meta = $("#f-meta");
  if (t) { meta.hidden = false; meta.textContent = `Logged by ${t.loggedBy && t.loggedBy !== t.by ? `${who(t.loggedBy).name} for ${who(t.by).name}` : who(t.by).name}${t.createdAt ? " · " + ago(t.createdAt) : ""}${t.updatedAt && t.updatedBy ? ` · last edited by ${who(t.updatedBy).name}` : ""}`; }
  else meta.hidden = true;
  loadPhotos(t);
  showSheet();
  // New entry: put the cursor in the amount right away, still inside the tap, so iPhones show the
  // number keyboard too (they ignore focus that happens after a delay). Editing doesn't pop it up.
  if (!t) $("#f-amount").focus();
}
function openRecSheet(r) {
  S.editing = null; S.editingRec = r.id; S.delArmed = false;
  forWho = meNow(); $("#forWrap").hidden = true;
  setSheetMode(true);
  $("#sheetTitle").textContent = "Edit recurring";
  $("#f-err").textContent = "";
  const del = $("#f-del"); del.hidden = false; del.classList.remove("armed"); del.textContent = "Stop repeating";
  setType(r.type, r.cat);
  $("#f-amount").value = grouped(r.amount);
  fillAccounts();
  const wk = byWeekday(r);
  $("#f-rep-by").value = wk ? "weekday" : "date";
  $("#f-day").value = String(r.day);
  // Switching a date to a weekday starts from the weekday its day fell on when it was set up.
  const first = new Date(`${r.lastPosted}-${pad(Math.min(r.day, daysIn(r.lastPosted)))}T00:00:00`);
  $("#f-week").value = String(wk ? r.week : Math.min(5, Math.ceil(r.day / 7)));
  $("#f-weekday").value = String(wk ? r.weekday : first.getDay());
  syncRepBy();
  pickAccount($("#f-acct"), r.acct);
  $("#f-note").value = r.note;
  const meta = $("#f-meta");
  meta.hidden = false;
  meta.textContent = `Set up by ${who(r.createdBy).name} · next added ${recNext(r)}. Changes apply from then on; entries already added stay as they are.`;
  loadPhotos(null); // recurring items have no photos (renderPhotos hides the paperclip)
  showSheet();
}
// The form blooms out from the bottom centre when shown (CSS on .scrim) and shrinks back into it here.
function showSheet() {
  const scrim = $("#scrim");
  scrim.classList.remove("closing");
  scrim.hidden = false;
}
function closeSheet() {
  const scrim = $("#scrim");
  S.editing = null; S.editingRec = null;
  photoForm.token++; // drops photos still loading or shrinking for this form
  if (scrim.hidden) return;
  const done = () => { if (scrim.classList.contains("closing")) { scrim.classList.remove("closing"); scrim.hidden = true; } };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { scrim.hidden = true; }
  else {
    scrim.classList.add("closing");
    scrim.addEventListener("animationend", done, { once: true });
    setTimeout(done, 300); // in case the animation doesn't run
  }
  $("#fab").focus({ preventScroll: true });
}

// ---------- Receipt photos ----------
// The paperclip beside Note attaches up to MAX_PHOTOS photos to an entry: picked from the phone's photos or taken
// with the camera (the phone offers both for one file box). Adding one shows a Description box for it.
// Each photo is shrunk to a JPEG under PHOTO_MAX characters and saved in photos/{entry id}, apart from the entry
// so opening the book doesn't download them; they're fetched when the entry is opened. The entry keeps only how
// many it has ("photos"), which puts a paperclip after its name in the list, and the description ("desc").
// Sample data keeps them in memory.
// "This phone only" mode has no room for photos (browser storage holds about 5 MB), so it has no paperclip.
const PHOTO_MAX = 290000;
const PHOTO_SIZES = [[1280, 0.72], [1024, 0.62], [800, 0.55], [640, 0.5]];
const photoForm = { list: [], had: 0, changed: false, loading: false, failed: false, token: 0 };
const photosAllowed = () => S.demo || !!S.user;

// Shrinks the picture at `src` (a file's object URL or a data URL) to a JPEG data URL that fits `limit`.
async function shrinkImage(src, sizes, limit) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const canvas = document.createElement("canvas");
  for (const [max, q] of sizes) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k)); canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height); // PNGs with see-through parts
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", q);
    if (out.length <= limit) return out;
  }
  return null;
}
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try { return await shrinkImage(url, PHOTO_SIZES, PHOTO_MAX); } finally { URL.revokeObjectURL(url); }
}

function renderPhotos() {
  const box = $("#f-photos"), f = photoForm;
  $("#attachMenu").hidden = true;
  $("#f-attach").hidden =!photosAllowed() || sheet.dataset.mode === "rec" || f.loading || f.failed;
  const thumbs = f.list.map((src, i) => `<div class="ph"><button type="button" class="ph-open" data-act="photo-view" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${src}" alt=""></button>`
    + `<button type="button" class="ph-x" data-act="photo-remove" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
  const note = f.loading ? `<p class="meta">Loading photos…</p>` : f.failed ? `<p class="meta">Couldn't load this entry's photos. Check your connection and open it again.</p>` : "";
  box.innerHTML = thumbs + note;
  box.hidden = !thumbs && !note;
  // The Description box is only there while the entry has a photo (or its photos are still on their way).
  $("#descWrap").hidden = !(f.list.length || (!f.changed && f.had));
}

// Opening an entry: show its photos (fetched only now). Until they're in, the paperclip waits, and saving
// leaves the photos as they were.
async function loadPhotos(t) {
  const f = photoForm, token = ++f.token;
  Object.assign(f, { list: [], had: t && photosAllowed() ? t.photos : 0, changed: false, loading: false, failed: false });
  $("#f-desc").value = t && t.photos ? t.desc : "";
  if (f.had) {
    if (S.demo) f.list = [...(S.demoPhotos[t.id] || [])];
    else {
      f.loading = true;
      renderPhotos();
      try {
        const snap = await S.db.collection("photos").doc(t.id).get();
        if (token !== f.token) return; // another entry was opened meanwhile
        f.list = snap.exists && Array.isArray(snap.data().images) ? snap.data().images.slice(0, MAX_PHOTOS) : [];
      } catch { if (token !== f.token) return; f.failed = true; }
      f.loading = false;
    }
  }
  renderPhotos();
}

async function addPhotos(files) {
  const f = photoForm, err = $("#f-err");
  err.textContent = "";
  const room = MAX_PHOTOS - f.list.length;
  if (files.length > room) err.textContent = room ? `An entry can have up to ${MAX_PHOTOS} photos, so only ${room === 1 ? "one was" : `the first ${room} were`} added.` : `An entry can have up to ${MAX_PHOTOS} photos. Remove one to add another.`;
  const token = f.token;
  for (const file of files.slice(0, room)) {
    let src = null;
    try { src = await shrinkPhoto(file); } catch {}
    if (token !== f.token) return; // the form was closed or another entry opened
    if (!src) { err.textContent = "That photo couldn't be added. Try a different one."; continue; }
    f.list.push(src); f.changed = true;
    renderPhotos();
  }
}

// A photo full screen; tap anywhere (or Escape) to close. `full` may still be loading: the small copy shows first.
function viewPhoto(src, full) {
  const v = document.createElement("button");
  v.type = "button"; v.className = "viewer"; v.setAttribute("aria-label", "Close photo");
  v.innerHTML = `<img src="${src}" alt="Receipt photo">`;
  v.addEventListener("click", () => v.remove());
  document.body.append(v);
  v.focus();
  if (full) full.then(big => { if (big && v.isConnected) v.querySelector("img").src = big; }).catch(() => {});
}
for (const box of [$("#f-file"), $("#f-cam")]) box.addEventListener("change", e => {
  const files = [...e.target.files].filter(x => x.type.startsWith("image/") || !x.type);
  e.target.value = ""; // so picking the same photo again still counts
  if (files.length) addPhotos(files);
});
// A tap anywhere but the paperclip and its menu closes the menu.
document.addEventListener("click", e => {
  if (!e.target.closest || e.target.closest("#attachMenu, #f-attach")) return;
  $("#attachMenu").hidden = true;
}, true);
// Escape closes an open photo first (and not the form behind it).
addEventListener("keydown", e => {
  const v = document.querySelector(".viewer");
  if (e.key === "Escape" && v) { v.remove(); e.stopImmediatePropagation(); }
}, true);

// For saving an entry (id `id`): store, replace or remove its photos, only if they were changed. Called before
// the entry itself is written, so the photos reach other phones before the entry that points to them.
function savePhotos(id, hadPhotos) {
  const f = photoForm;
  if (!f.changed) return Promise.resolve();
  const list = [...f.list];
  if (S.demo) { if (list.length) S.demoPhotos[id] = list; else delete S.demoPhotos[id]; return Promise.resolve(); }
  const ref = S.db.collection("photos").doc(id);
  if (list.length) return writeWithRetry(() => ref.set({ images: list, updatedAt: Date.now(), updatedBy: S.meId }));
  return hadPhotos ? writeWithRetry(() => ref.delete()) : Promise.resolve();
}
// An entry being deleted takes its photos with it.
function deletePhotos(t) {
  if (!t || !t.photos) return;
  if (S.demo) { delete S.demoPhotos[t.id]; return; }
  writeWithRetry(() => S.db.collection("photos").doc(t.id).delete()).catch(() => {});
}

async function saveRecurringEdit(type, amount, catEl) {
  const err = $("#f-err");
  if (!(amount > 0) || amount > 1e9) { err.textContent = "Enter an amount greater than ₱0."; $("#f-amount").focus(); return; }
  if (!catEl) { err.textContent = "Pick a category."; showCats(true); return; }
  const r = S.recurring.find(x => x.id === S.editingRec);
  if (!r) { closeSheet(); return; }
  const { week, weekday, ...rest } = r;
  const when = $("#f-rep-by").value === "weekday"
    ? { week: Number($("#f-week").value), weekday: Number($("#f-weekday").value) }
    : { day: Number($("#f-day").value) };
  const next = recData({
    ...rest, type, amount: Math.round(amount * 100) / 100, cat: catEl.value, acct: $("#f-acct").value,
    note: $("#f-note").value.trim().slice(0, 120), ...when
  });
  const btn = $("#f-save"); btn.disabled = true;
  try {
    await writeWithRetry(() => S.db.collection("recurring").doc(r.id).set(next));
    closeSheet();
    flash(`Updated. Next one is added ${recNext(next)}.`);
  } catch (x) { err.textContent = writeError(x); }
  finally { btn.disabled = false; }
}

sheet.addEventListener("change", e => {
  if (e.target.name === "type") setType(e.target.value);
  else if (e.target.name === "cat") { updateCatToggle(); showCats(false); $("#f-err").textContent = ""; }
  else if (e.target.id === "f-repeat" || e.target.id === "f-date") syncRepeat();
  else if (e.target.id === "f-rep-by") syncRepBy();
});
sheet.addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#f-err");
  const type = sheet.querySelector('input[name="type"]:checked').value;
  const amount = parseFloat(String($("#f-amount").value).replace(/[₱,\s]/g, ""));
  const date = $("#f-date").value;
  const acct = $("#f-acct").value, to = $("#f-to").value;
  const catEl = sheet.querySelector('input[name="cat"]:checked');
  if (S.editingRec) { saveRecurringEdit(type, amount, catEl); return; }
  if (!(amount > 0) || amount > 1e9) { err.textContent = "Enter an amount greater than ₱0."; $("#f-amount").focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = "Pick a date for this entry."; return; }
  const toOther = type === "transfer" && toWho !== toSender; // sent to another family member
  if (type === "transfer" && acct === to && !toOther) { err.textContent = "Choose two different accounts for a transfer."; return; }
  if (type !== "transfer" && !catEl) { err.textContent = "Pick a category."; showCats(true); return; }
  const prev = S.editing ? txAll().find(t => t.id === S.editing) : null;
  const me = S.demo ? "demo-a" : S.meId;
  const data = {
    type, amount: Math.round(amount * 100) / 100, date,
    cat: type === "transfer" ? "transfer" : catEl.value, acct, to: type === "transfer" ? to : null,
    note: $("#f-note").value.trim().slice(0, 120),
    ...(toOther ? { toWho } : {}),
    // Yours, or (new, For someone else) theirs, noting that you logged it.
    by: prev ? prev.by : forWho, ...(!prev && forOther() ? { loggedBy: me } : prev && prev.loggedBy ? { loggedBy: prev.loggedBy } : {}),
    createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: prev ? Date.now() : 0, updatedBy: prev ? me : null,
    ...(prev && prev.order != null && prev.date === date ? { order: prev.order } : {}) // keeps its place unless its day changes
  };
  // How many receipt photos it has; unchanged (or still loading) photos keep the count it had.
  const photos = photoForm.changed ? photoForm.list.length : prev ? prev.photos : 0;
  if (photos) data.photos = photos;
  const desc = photos ? $("#f-desc").value.trim().slice(0, 200) : ""; // a description only goes with photos
  if (desc) data.desc = desc;
  if (data.date.slice(0, 7) !== S.month) S.month = data.date.slice(0, 7);
  if (S.view === "calendar") S.selDay = data.date;
  // Confirmation banner, e.g. "✓ ₱145 expense added · Groceries · Cash".
  const repeats = !prev && type !== "transfer" && $("#f-repeat").checked;
  const where = type === "transfer" ? `${acctOf(acct).n} → ${toName(data, toWho)}${acctOf(to).n}` : `${catOf(type, data.cat).n} · ${acctOf(acct).n}`;
  const saved = prev ? "✓ Entry updated"
    : `✓ ${peso(data.amount)} ${type} added · ${where}${repeats ? ` · repeats on the ${repeatLabel(chosenPattern())}` : ""}`;
  // The check card the saving card turns into, e.g. "Expense added / ₱1 / Other · Cash".
  // Dated after today: it's upcoming, so the card says when it will count ("Expense scheduled · for Wed, 11 Nov").
  const later = isUpcoming(data);
  const when = later ? `for ${new Date(date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short" })} · ` : "";
  const done = {
    title: prev ? (later ? "Upcoming entry updated" : "Entry updated") : `${type[0].toUpperCase()}${type.slice(1)} ${later ? "scheduled" : "added"}`,
    amount: peso(data.amount), cls: type === "income" ? "inc" : type === "expense" ? "exp" : "",
    sub: when + where + (repeats ? ` · repeats on the ${repeatLabel(chosenPattern())}` : ""), text: later ? saved.replace(" added", " scheduled") : saved
  };
  if (S.demo) {
    const row = { id: prev ? prev.id : "demo" + Date.now(), photos: 0, desc: "", ...data };
    savePhotos(row.id, false);
    S.demoTx = prev ? S.demoTx.map(t => t.id === prev.id ? row : t) : [...S.demoTx, row];
    closeSheet(); paint(); showLoader("").done({ ...done, after: () => showEntry(row.id) }); return;
  }
  // The form closes right away and a full-screen "Saving your entry…" shows until the save is through.
  // Firestore puts the entry on this phone the moment it's written, then sends it on, which can take seconds
  // with photos or a slow connection (the db waits up to 4 s for the server; offline, not at all). The writes
  // go out in order: the recurring item, the photos, then the entry that points to them.
  const writes = [];
  let ref = prev ? S.db.collection("tx").doc(prev.id) : S.db.collection("tx").doc();
  if (repeats) {
    // This entry is the first month; later months are added by postRecurring() under the same id scheme.
    const rid = newId(), month = date.slice(0, 7);
    writes.push(writeWithRetry(() => S.db.collection("recurring").doc(rid).set(recData({
      type, amount: data.amount, cat: data.cat, acct, note: data.note, ...chosenPattern(),
      lastPosted: month, active: true, createdBy: me, createdAt: Date.now()
    }))));
    ref = S.db.collection("tx").doc(`r_${rid}_${month}`);
    data.rec = rid;
  }
  writes.push(savePhotos(ref.id, !!(prev && prev.photos)));
  writes.push(writeWithRetry(() => ref.set(data)));
  const editing = S.editing;
  const uploading = photoForm.changed && photoForm.list.length;
  closeSheet();
  const loader = showLoader("Saving your entry…", uploading ? `Uploading ${uploading} photo${uploading === 1 ? "" : "s"}` : "");
  Promise.all(writes).then(() => loader.done({ ...done, after: () => showEntry(ref.id) })).catch(x => {
    // Refused (e.g. no longer allowed to edit): the entry drops out of the list again. The form still holds
    // what was typed, so "Try again" brings it back as it was.
    loader.hide();
    const msg = writeError(x);
    flash(msg, 12000, () => { S.editing = editing; showSheet(); $("#f-err").textContent = msg; }, { label: "Try again" });
  });
});

// A new day: upcoming entries dated today start counting. Redraw at midnight if the app is open, and when it comes
// back on screen on a later day (phones pause timers while an app is in the background).
let shownDay = todayISO();
function checkNewDay() {
  if (todayISO() === shownDay) return;
  shownDay = todayISO();
  paint();
}
(function atMidnight() {
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { checkNewDay(); atMidnight(); }, next - now);
})();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkNewDay(); });

// After saving: scroll the list to that entry and light it up for a moment, so it's easy to spot.
// Only when it's on screen (the Daily list or the calendar's day, not another tab).
// The glow carries on through list redraws (txRow picks it up from `glow` partway through).
const GLOW_MS = 2200;
let glow = null; // { id, at }
function showEntry(id) {
  const btn = [...document.querySelectorAll("#main .tx-edit")].find(b => b.dataset.id === id);
  const wrap = btn && btn.closest(".tx-wrap");
  if (!wrap) return;
  wrap.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
  glow = { id, at: Date.now() };
  wrap.classList.remove("just-saved");
  void wrap.offsetWidth; // restart the glow if it's still going
  wrap.classList.add("just-saved");
}
const glowAttrs = id => {
  const left = glow && glow.id === id ? GLOW_MS - (Date.now() - glow.at) : 0;
  return left > 0 ? ` just-saved" style="--glow-delay:${left - GLOW_MS}ms` : "";
};

// ---------- Bank interest ----------
// MariBank adds interest daily. Tapping your own MariBank amount in the Balances table asks what the MariBank app
// shows now; the difference from AlkanSave's amount (your starting balance plus your MariBank entries) is logged as
// an income entry: Interest, your MariBank, "Maribank Interest", today. Nothing is added when the difference
// isn't positive: then AlkanSave already matches, or an expense or transfer is probably missing.
const round2 = v => Math.round(v * 100) / 100;
function askInterest() {
  const me = S.demo ? "demo-a" : S.meId || "local";
  const a = acctOf(INTEREST_ACCOUNT);
  const have = round2(personalBalance(me, a.k));
  const el = document.createElement("div");
  el.className = "ask";
  el.innerHTML = `<form class="ask-card" role="dialog" aria-modal="true" aria-labelledby="askTitle" novalidate>
      <h2 id="askTitle">${acctIcon(a)}${esc(a.n)} interest</h2>
      <p>AlkanSave has <b class="num">${peso(have)}</b> in your ${esc(a.n)}. How much does your ${esc(a.n)} app show now?</p>
      <label class="ask-amt"><span>₱</span><input id="interest-amt" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Your ${esc(a.n)} balance now"></label>
      <p class="ask-result" aria-live="polite"></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Add interest</button></div>
    </form>`;
  const input = el.querySelector("input"), result = el.querySelector(".ask-result");
  const diff = () => input.value.trim() ? round2(parseAmount(input.value) - have) : null;
  const show = () => {
    const d = diff();
    result.className = "ask-result" + (d > 0 ? " inc" : d === null ? "" : " warn");
    result.textContent = d === null ? "" : d > 0 ? `Interest to add: ${peso(d)}`
      : d === 0 ? `Your ${a.n} already matches. There's no interest to add.`
      : `Your ${a.n} in AlkanSave is ${peso(-d)} more than that. An expense or transfer may be missing.`;
  };
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = e => { if (e.key === "Escape") { e.stopImmediatePropagation(); close(); } };
  input.addEventListener("input", show);
  el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) close(); });
  el.querySelector("form").addEventListener("submit", e => {
    e.preventDefault();
    const d = diff();
    if (!(d > 0)) { if (d === null) { result.className = "ask-result warn"; result.textContent = `Enter what your ${a.n} app shows now.`; } else show(); input.focus(); return; }
    close();
    addInterest(d);
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(el);
  input.focus(); // still inside the tap, so phones bring up the number keyboard
}
// Saves the interest as a new income entry, with the same saving card and green check as the entry form.
function addInterest(amount) {
  const a = acctOf(INTEREST_ACCOUNT), cat = catOf("income", "interest");
  const data = {
    type: "income", amount, date: todayISO(), cat: cat.k, acct: a.k, to: null, note: `${a.n} Interest`,
    by: S.demo ? "demo-a" : S.meId, createdAt: Date.now(), updatedAt: 0, updatedBy: null
  };
  const done = { title: "Interest added", amount: peso(amount), cls: "inc", sub: `${cat.n} · ${a.n}`, text: `✓ ${peso(amount)} interest added · ${a.n}` };
  if (S.demo) {
    S.demoTx = [...S.demoTx, { id: "demo" + Date.now(), photos: 0, desc: "", order: null, ...data }];
    paint(); showLoader("").done(done); return;
  }
  const ref = S.db.collection("tx").doc();
  const loader = showLoader("Adding interest…");
  writeWithRetry(() => ref.set(data)).then(() => loader.done(done)).catch(x => { loader.hide(); flash(writeError(x)); });
}

// Full-screen "busy" card over the app, e.g. "Saving your entry…". Returns { done(info), hide() }.
// done() turns the spinner into a green check with what was saved (info: title, amount, cls, sub), which
// fades after DONE_MS or on a tap. The spinner waits LOADER_DELAY_MS before showing, so a save that's
// through at once (offline, say) goes straight to the check. It never spins longer than LOADER_MAX_MS:
// past that it steps aside for "Saving…" at the bottom, and the result shows there too (info.text).
const LOADER_DELAY_MS = 150, LOADER_MAX_MS = 8000, DONE_MS = 1400;
function showLoader(title, sub = "") {
  const el = document.createElement("div");
  el.className = "loader";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="loader-card"><div class="loader-ring" aria-hidden="true"></div><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;
  const show = setTimeout(() => document.body.append(el), LOADER_DELAY_MS);
  let gone = false, timedOut = false, after = null;
  const hide = () => {
    if (gone) return;
    gone = true; clearTimeout(show); clearTimeout(slow);
    if (el.isConnected) { el.classList.add("closing"); setTimeout(() => el.remove(), 160); }
    if (after) after();
  };
  const slow = setTimeout(() => { timedOut = true; hide(); flash("Saving…", 120000, null, { busy: true }); }, LOADER_MAX_MS);
  // info.after runs once the check card is gone (e.g. scroll to the saved entry).
  const done = info => {
    if (timedOut) { flash(info.text, 3500); if (info.after) info.after(); return; }
    if (gone) return;
    after = info.after || null;
    clearTimeout(show); clearTimeout(slow);
    el.classList.add("done");
    el.innerHTML = `<div class="loader-card"><div class="loader-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>`
      + `<b>${esc(info.title)}</b><strong class="num ${info.cls}">${esc(info.amount)}</strong>${info.sub ? `<span>${esc(info.sub)}</span>` : ""}</div>`;
    if (!el.isConnected) document.body.append(el);
    el.addEventListener("click", hide, { once: true });
    setTimeout(hide, DONE_MS);
  };
  return { done, hide };
}

async function writeWithRetry(fn) {
  try { return await fn(); }
  catch (x) {
    if (x && x.code === "unavailable") { await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
    throw x;
  }
}
function writeError(x) {
  const code = x && x.code;
  if (code === "permission-denied") { S.canWrite = false; drawChrome(); return "This book is view-only for you. Ask the owner to make you an Editor."; }
  if (code === "resource-exhausted") return "Too many saves at once. Wait a moment and try again.";
  return "Couldn't save just now. Check your connection and try again.";
}

async function deleteEntry() {
  const rid = S.editingRec;
  if (rid) {
    if (!S.delArmed) { S.delArmed = true; const b = $("#f-del"); b.classList.add("armed"); b.textContent = "Tap again to stop"; return; }
    try { await writeWithRetry(() => S.db.collection("recurring").doc(rid).delete()); closeSheet(); flash("Stopped. Entries already added stay in the book."); }
    catch (x) { $("#f-err").textContent = writeError(x); }
    return;
  }
  const id = S.editing; if (!id) return;
  if (!S.delArmed) { S.delArmed = true; const b = $("#f-del"); b.classList.add("armed"); b.textContent = "Tap again to delete"; return; }
  const t = txAll().find(x => x.id === id);
  if (S.demo) { S.demoTx = S.demoTx.filter(t => t.id !== id); deletePhotos(t); closeSheet(); paint(); return; }
  try { await writeWithRetry(() => S.db.collection("tx").doc(id).delete()); deletePhotos(t); closeSheet(); }
  catch (x) { $("#f-err").textContent = writeError(x); }
}

// ---------- Budgets ----------
let budgetQueue = Promise.resolve();
function saveBudget(k, raw) {
  const v = Math.round(parseFloat(String(raw).replace(/[₱,\s]/g, "")) || 0);
  const target = S.demo ? S.demoBudgets : S.budgets;
  if ((target[k] || 0) === v) return;
  if (v > 0) target[k] = v; else delete target[k];
  if (S.demo) return;
  const limits = { ...S.budgets };
  budgetQueue = budgetQueue.then(() => writeWithRetry(() => S.db.doc("config/budgets").set({ limits, updatedAt: Date.now(), updatedBy: S.meId }))).catch(x => { writeError(x); draw(); });
}

// ---------- Starting balances ----------
// Starting balances save as you type and when you leave the box (see saveBox). Each save goes out right away rather than waiting for the
// one before it to reach the server: Firestore shows it on this phone at once (offline too) and sends this phone's
// saves in order. Waiting held back every amount after the first on a slow connection, and they could undo each other.
// Saves the shared Cash / Atome starting balance (config/shared) for the whole family.
function saveSharedStart(k, raw) {
  const v = parseAmount(raw) * (isOwed(k) ? -1 : 1);
  const start = { ...sharedStarts() };
  if ((start[k] || 0) === v) return;
  if (v) start[k] = v; else delete start[k];
  S.sharedStart = start;
  writeWithRetry(() => S.db.doc("config/shared").set({ start, updatedAt: Date.now(), updatedBy: S.meId }))
    .catch(x => { flash(writeError(x)); draw(); });
}
// Saves your own starting balances: on your member record in a family book, or in this browser otherwise.
// In a family book only the changed account is written. The first save of someone whose amounts are still kept
// the old shared way writes them all, which moves them over to their member record.
function saveStart(k, raw) {
  const v = parseAmount(raw) * (isOwed(k) ? -1 : 1);
  const start = { ...startsOf(S.meId) };
  if ((start[k] || 0) === v) return;
  if (v) start[k] = v; else delete start[k];
  const mine = S.user && S.user.members().find(m => m.id === S.meId);
  const write = !S.user
    ? () => { S.legacyStart = start; return S.db.doc("config/accounts").set({ start, updatedAt: Date.now(), updatedBy: S.meId }); }
    : mine && mine.start && typeof mine.start === "object"
      ? () => S.user.setStartAmount(k, v)
      : () => S.user.setStart(start);
  writeWithRetry(write).catch(x => { flash(writeError(x)); draw(); });
}

// ---------- Recurring ----------
// Adds each recurring item's entries for every month that's due (its day has arrived), up to 12 months back.
// Entry ids are fixed per item and month, so two phones posting at once can't create duplicates.
let posting = false;
async function postRecurring() {
  if (posting || S.demo || !S.canWrite || !S.recLoaded || !S.db) return;
  posting = true;
  const today = todayISO(), thisMonth = today.slice(0, 7);
  for (const r of S.recurring) {
    if (!r.active || !r.createdBy) continue;
    let month = r.lastPosted, posted = null;
    try {
      for (let i = 0; i < 12; i++) {
        const next = shiftMonth(month, 1);
        const date = dueDate(r, next);
        if (next > thisMonth || date > today) break;
        await S.db.collection("tx").doc(`r_${r.id}_${next}`).set({
          type: r.type, amount: r.amount, date, cat: r.cat, acct: r.acct, to: null, note: r.note,
          by: r.createdBy, createdAt: Date.now(), updatedAt: 0, updatedBy: null, rec: r.id
        });
        month = posted = next;
      }
    } catch (x) { console.warn("AlkanSave recurring:", x); } // usually another phone posted it first
    if (posted) {
      try { await S.db.collection("recurring").doc(r.id).set(recData({ ...r, lastPosted: posted })); }
      catch (x) { console.warn("AlkanSave recurring:", x); }
    }
  }
  posting = false;
}

// ---------- Two-tap confirmations ----------
// First tap arms the button ("Tap to remove"), a second tap within 4 seconds does it.
let armTimer = 0;
function confirmTap(key) {
  if (S.armed === key) { S.armed = ""; clearTimeout(armTimer); return true; }
  S.armed = key; draw();
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { S.armed = ""; draw(); }, 4000);
  return false;
}
async function removeMember(id) {
  if (!confirmTap("remove:" + id)) return;
  try { await S.user.removeMember(id); flash(`${who(id).name} was removed from the book.`); }
  catch { flash("Couldn't remove them. Check your connection and try again."); }
  draw();
}
async function leaveBook() {
  if (!confirmTap("leave")) return;
  try { await S.user.leave(); }
  catch { flash("Couldn't leave the book. Check your connection and try again."); draw(); }
}

// ---------- Events ----------
// Closes the filter panel by removing just the panel (no full redraw), so a tap into the search box
// keeps its cursor. keepPlace: scroll up by the panel's height so the list doesn't jump under your finger.
function closeFilters(keepPlace) {
  S.showFilters = false;
  const panel = document.querySelector(".filters:not(.closing)");
  if (panel && keepPlace) {
    // Closing because of a scroll: remove it at once, or the animation would fight the finger.
    const h = panel.offsetHeight + parseFloat(getComputedStyle($("#main")).rowGap || 0);
    panel.remove();
    window.scrollBy(0, -h);
  } else if (panel) {
    panel.classList.add("closing"); // no longer the open panel while it folds away
    foldShut(panel, () => panel.remove());
  }
  const btn = document.querySelector('[data-act="filters"]');
  if (btn) { btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-expanded", "false"); }
}

// Scrolling the list closes the filter panel, except while one of its dropdowns is in use
// (iPhones scroll the page a little when a dropdown opens).
let filterScrollFrom = null;
addEventListener("scroll", () => {
  if (!S.showFilters) { filterScrollFrom = null; return; }
  if (filterScrollFrom === null) { filterScrollFrom = scrollY; return; }
  const active = document.activeElement;
  if (active && active.closest && active.closest(".filters")) return;
  if (scrollY - filterScrollFrom > 12) { filterScrollFrom = null; closeFilters(true); }
}, { passive: true });

// ---------- Swipe an entry left to edit or delete ----------
// Only sideways drags start a swipe (touch-action: pan-y leaves up/down scrolling to the browser).
// One row is open at a time; tapping anywhere, scrolling, or swiping back closes it.
// Dragging past the buttons stretches Delete (the outer one) after the finger; past FULL_SWIPE of the row's
// width, Edit tucks away, and letting go there deletes the entry, with Undo for a few seconds.
// Round buttons: matches .tx-actions in styles.css (42px circles, 12px around and between them).
const BTN = 42, PAD = 12;
const ACTIONS_W = PAD + BTN + PAD + BTN + PAD; // 120: Edit + Delete
const FULL_SWIPE = 0.6;
let swipe = null, openRow = null, delTimer = 0;
function swipeBusy() { return !!(swipe && swipe.sideways && swipe.wrap.isConnected) || !!(openRow && openRow.isConnected) || !!move; }
const catchUp = () => { if (pending && !swipeBusy()) draw(); };
const rowOf = el => el && el.closest ? el.closest(".tx-wrap") : null;
const actionsWidth = () => ACTIONS_W;
function setRowOffset(wrap, x, animate) {
  wrap.querySelector(".tx").style.transform = x ? `translateX(${x}px)` : "";
  wrap.classList.toggle("dragging", !animate);
  wrap.classList.toggle("open", x < 0); // rounds the entry's right edge while it's slid over
  // The Delete circle stretches into a pill over whatever is uncovered beyond the two buttons
  // (all of it in a full swipe, when Edit tucks away).
  const del = wrap.querySelector(".tx-del");
  const full = -x > wrap.offsetWidth * FULL_SWIPE;
  wrap.classList.toggle("full", full);
  if (del) del.style.width = -x > ACTIONS_W ? `${full ? -x - 2 * PAD : -x - (ACTIONS_W - BTN)}px` : "";
}
// Full swipe: slide the entry the rest of the way out, then delete it (the list redraws without it).
function fullSwipeDelete(wrap) {
  const id = wrap.querySelector(".tx-del").dataset.id;
  openRow = wrap; // holds off list redraws during the slide
  setRowOffset(wrap, -wrap.offsetWidth, true);
  setTimeout(() => {
    openRow = null;
    deleteWithUndo(id);
  }, 200);
}
function disarmDelete(wrap) {
  const b = wrap && wrap.querySelector(".tx-del.armed");
  if (b) { b.classList.remove("armed"); b.setAttribute("aria-label", "Delete"); }
}
function closeRow() {
  if (!openRow) return;
  if (!openRow.isConnected) { openRow = null; return; } // the list was redrawn since it opened
  setRowOffset(openRow, 0, true);
  disarmDelete(openRow);
  openRow = null;
  setTimeout(catchUp, 220); // after the slide-back animation
}
function openSwipeRow(wrap) {
  if (openRow && openRow !== wrap) closeRow();
  setRowOffset(wrap, -actionsWidth(wrap), true);
  openRow = wrap;
}

$("#main").addEventListener("pointerdown", e => {
  const wrap = rowOf(e.target);
  if (!wrap || wrap.dataset.ro || e.target.closest(".tx-actions")) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  swipe = { wrap, id: e.pointerId, x0: e.clientX, y0: e.clientY, base: wrap === openRow ? -actionsWidth(wrap) : 0, dx: 0, sideways: false };
});
addEventListener("pointermove", e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  if (!swipe.sideways) {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      swipe.sideways = true;
      if (openRow && openRow !== swipe.wrap) closeRow();
      try { swipe.wrap.querySelector(".tx").setPointerCapture(e.pointerId); } catch {}
    } else if (Math.abs(dy) > 8) { swipe = null; return; }
    else return;
  }
  swipe.dx = dx;
  setRowOffset(swipe.wrap, Math.max(-swipe.wrap.offsetWidth, Math.min(0, swipe.base + dx)), false);
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe;
  swipe = null;
  if (!s.sideways) return; // a plain tap; the click handler deals with it
  s.wrap.dataset.swipedAt = String(Date.now()); // ignore the click that follows the drag
  const x = s.base + s.dx;
  if (-x > s.wrap.offsetWidth * FULL_SWIPE) fullSwipeDelete(s.wrap);
  else if (x < -actionsWidth(s.wrap) / 2) openSwipeRow(s.wrap);
  else { setRowOffset(s.wrap, 0, true); disarmDelete(s.wrap); if (openRow === s.wrap) openRow = null; setTimeout(catchUp, 220); }
}
addEventListener("pointerup", endSwipe);
addEventListener("pointercancel", endSwipe);
addEventListener("scroll", () => { if (openRow && !swipe) closeRow(); }, { passive: true });

// ---------- Long-press an entry to move it ----------
// Hold an entry still for HOLD_MS and it lifts; drag it up or down among that day's entries and let go.
// It stays on its day. The new place is saved as an order between its new neighbours (posOf), so the whole
// family sees the same order; only that entry is written. Not in search or filter results (they mix days),
// and not for view-only members.
const HOLD_MS = 450, STEP = 60000; // STEP: gap when dropped first or last (orders start from -createdAt)
let hold = null, move = null;
const pageTop = el => el.getBoundingClientRect().top + scrollY;

$("#main").addEventListener("pointerdown", e => {
  const wrap = rowOf(e.target);
  if (wrap) delete wrap.dataset.held;
  if (!wrap || wrap.dataset.ro || e.target.closest(".tx-actions") || move || !(S.demo || S.canWrite) || filtering()) return;
  if ((e.pointerType === "mouse" && e.button !== 0) || (openRow && openRow.isConnected)) return;
  clearTimeout(hold && hold.timer);
  hold = { wrap, id: e.pointerId, x0: e.clientX, y0: e.clientY, timer: setTimeout(startMove, HOLD_MS) };
});
// Any real movement before the hold completes is a scroll or a swipe, not a move.
addEventListener("pointermove", e => {
  if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > 8) { clearTimeout(hold.timer); hold = null; }
  if (move && e.pointerId === move.id) { move.y = e.clientY; dragTo(); }
});

function startMove() {
  const h = hold; hold = null;
  if (!h || !h.wrap.isConnected) return;
  h.wrap.dataset.held = "1"; // letting go after a hold doesn't open the entry (cleared by the next press)
  const day = h.wrap.closest(".day"), rows = day ? [...day.querySelectorAll(".tx-wrap")] : [];
  if (rows.length < 2) { flash("This is the only entry on its day, so there's nowhere to move it.", 3000); return; }
  swipe = null; // the hold wins over a swipe
  const idx = rows.indexOf(h.wrap), others = rows.filter(r => r !== h.wrap);
  move = {
    id: h.id, wrap: h.wrap, idx, target: idx, others, y: h.y0,
    startY: h.y0 + scrollY, top: pageTop(h.wrap), height: h.wrap.offsetHeight,
    min: pageTop(rows[0]) - pageTop(h.wrap),
    max: pageTop(rows[rows.length - 1]) + rows[rows.length - 1].offsetHeight - pageTop(h.wrap) - h.wrap.offsetHeight,
    mids: others.map(r => pageTop(r) + r.offsetHeight / 2)
  };
  h.wrap.dataset.swipedAt = String(Date.now());
  h.wrap.classList.add("moving");
  others.forEach(r => r.classList.add("shift"));
  document.body.classList.add("moving-entry");
  try { h.wrap.setPointerCapture(h.id); } catch {}
  if (navigator.vibrate) navigator.vibrate(15);
  autoScroll();
}

// Follows the finger (kept within the day) and slides the other entries out of the way.
function dragTo() {
  const m = move;
  // It may go a little past the day's first and last entries, so the top and bottom spots are easy to reach.
  const dy = Math.max(m.min - m.height * 0.6, Math.min(m.max + m.height * 0.6, m.y + scrollY - m.startY));
  m.wrap.style.transform = `translateY(${dy}px)`;
  const centre = m.top + dy + m.height / 2;
  m.target = m.mids.filter(mid => mid < centre).length; // how many of the others end up above it
  m.others.forEach((r, k) => {
    const shift = k < m.idx && k >= m.target ? m.height : k >= m.idx && k < m.target ? -m.height : 0;
    r.style.transform = shift ? `translateY(${shift}px)` : "";
  });
}
// Near the top (under the header) or bottom (above the tab bar), the page scrolls while an entry is held.
function autoScroll() {
  if (!move) return;
  const top = $(".top").getBoundingClientRect().bottom + 48, bottom = innerHeight - 110;
  const speed = move.y < top ? -Math.min(14, (top - move.y) / 4) : move.y > bottom ? Math.min(14, (move.y - bottom) / 4) : 0;
  if (speed) { scrollBy(0, speed); dragTo(); }
  requestAnimationFrame(autoScroll);
}
// Stops scrolling under the finger once an entry is lifted (pan-y would otherwise take over).
document.addEventListener("touchmove", e => { if (move) e.preventDefault(); }, { passive: false });
$("#main").addEventListener("contextmenu", e => { if (rowOf(e.target)) e.preventDefault(); });

function endMove(e) {
  if (hold && e.pointerId === hold.id) { clearTimeout(hold.timer); hold = null; }
  if (!move || e.pointerId !== move.id) return;
  const m = move, t = e.type === "pointercancel" ? m.idx : m.target;
  m.wrap.dataset.swipedAt = String(Date.now());
  // Settle into the gap, then save and redraw in the new order.
  const dest = t === m.idx ? 0 : t > m.idx
    ? pageTop(m.others[t - 1]) + m.others[t - 1].offsetHeight - m.top - m.height - (parseFloat(m.others[t - 1].style.transform.slice(11)) || 0)
    : pageTop(m.others[t]) - m.top - (parseFloat(m.others[t].style.transform.slice(11)) || 0);
  m.wrap.classList.add("settling");
  m.wrap.style.transform = `translateY(${dest}px)`;
  setTimeout(() => {
    move = null;
    document.body.classList.remove("moving-entry");
    [m.wrap, ...m.others].forEach(r => { r.classList.remove("moving", "shift", "settling"); r.style.transform = ""; });
    if (t !== m.idx) placeEntry(m.wrap.querySelector(".tx-edit").dataset.id, t);
    catchUp();
  }, calm() ? 0 : 180);
}
addEventListener("pointerup", endMove);
addEventListener("pointercancel", endMove);

// Puts entry `id` at position `t` among the other entries of its day and saves it, with Undo.
function placeEntry(id, t) {
  const all = txAll(), me = all.find(x => x.id === id);
  if (!me) return;
  const others = all.filter(x => x.date === me.date && x.id !== id).sort((a, b) => posOf(a) - posOf(b));
  const before = others[t - 1], after = others[t];
  let changes = [[me, before && after ? (posOf(before) + posOf(after)) / 2 : before ? posOf(before) + STEP : posOf(after) - STEP]];
  // Two neighbours too close to fit anything between them (after a great many moves): space the whole day out again.
  if (before && after && !(changes[0][1] > posOf(before) && changes[0][1] < posOf(after))) {
    const base = posOf(others[0]);
    changes = [...others.slice(0, t), me, ...others.slice(t)].map((x, i) => [x, base + i * STEP]);
  }
  const undo = changes.map(([x]) => [x, x.order]);
  const apply = list => {
    list.forEach(([x, order]) => { x.order = order; }); // show it right away; the saved copy follows
    paint();
    if (S.demo) return;
    Promise.all(list.map(([x, order]) => writeWithRetry(() => S.db.collection("tx").doc(x.id).update({ order }))))
      .catch(x => { flash(writeError(x)); });
  };
  apply(changes);
  flash("Moved.", 5000, () => { apply(undo); flash("Move undone.", 2500); });
}

// Delete asks once more before removing the entry: the trash turns into a ✓ to tap.
async function deleteFromRow(btn) {
  const wrap = rowOf(btn), id = btn.dataset.id;
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.setAttribute("aria-label", "Tap again to delete");
    flash("Tap ✓ to delete this entry.", 4000);
    clearTimeout(delTimer);
    delTimer = setTimeout(() => disarmDelete(wrap), 4000);
    return;
  }
  clearTimeout(delTimer);
  if (openRow === wrap) openRow = null;
  deleteWithUndo(id);
}

// Deleting from a row hides the entry at once and shows "Entry deleted" with Undo for UNDO_MS. Only when that
// runs out (or another entry is deleted, or the app is left) is it really deleted. Undo just shows it again,
// so it works for anyone's entry, which re-creating it wouldn't (only the person who logged an entry can add it).
const UNDO_MS = 4000;
let pendingDelete = null;
function deleteWithUndo(id) {
  finishDelete();
  hiddenTx.add(id);
  const timer = setTimeout(finishDelete, UNDO_MS);
  pendingDelete = { id, timer };
  paint();
  flash("Entry deleted.", UNDO_MS, () => {
    if (!pendingDelete || pendingDelete.id !== id) return;
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;
    hiddenTx.delete(id);
    paint();
    flash("Delete undone.", 2500);
  });
}
async function finishDelete() {
  const p = pendingDelete;
  if (!p) return;
  pendingDelete = null;
  clearTimeout(p.timer);
  const t = (S.demo ? S.demoTx : S.tx).find(x => x.id === p.id);
  if (S.demo) { S.demoTx = S.demoTx.filter(t => t.id !== p.id); hiddenTx.delete(p.id); deletePhotos(t); return; }
  try { await writeWithRetry(() => S.db.collection("tx").doc(p.id).delete()); deletePhotos(t); }
  catch (x) { flash(writeError(x)); }
  hiddenTx.delete(p.id); // gone from the list by now, or back if the delete was refused
  paint();
}
addEventListener("pagehide", finishDelete);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") finishDelete(); });

document.addEventListener("click", e => {
  // A tap anywhere outside the open filter panel closes it (the Filter button toggles it itself).
  // The tap still does whatever it was aimed at, e.g. opening an entry.
  if (S.showFilters && !e.target.closest(".filters") && !e.target.closest('[data-act="filters"]')) closeFilters(false);
  // Entries: a tap on the row opens its edit form. While a row is swiped open, the tap only closes it;
  // the tap that ends a swipe or a hold does nothing. View-only members can't edit, so their taps do nothing.
  const wrap = rowOf(e.target);
  const justSwiped = !!wrap && (Date.now() - Number(wrap.dataset.swipedAt || 0) < 500 || !!wrap.dataset.held);
  const wasOpen = !!openRow && openRow.isConnected;
  if (wasOpen && !justSwiped && !(wrap === openRow && e.target.closest(".tx-actions"))) closeRow();
  if (wrap && !e.target.closest(".tx-actions")) {
    const edit = wrap.querySelector(".tx-edit");
    if (!justSwiped && !wasOpen && edit) { const t = txAll().find(x => x.id === edit.dataset.id); if (t) openSheet(t); }
    return;
  }
  const v = e.target.closest("[data-view]");
  if (v) { if (v.dataset.view !== S.view) animate("view"); S.view = v.dataset.view; S.armed = ""; if (!S.q) S.searchOpen = false; try { localStorage.setItem("alkansave.view", S.view); } catch {} draw(); window.scrollTo(0, 0); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "prev" || act === "next") { S.month = shiftMonth(S.month, act === "prev" ? -1 : 1); if (S.demo) buildDemo(); animate(act); draw(); }
  else if (act === "add") openSheet(null);
  else if (act === "edit") { closeRow(); const t = txAll().find(x => x.id === a.dataset.id); if (t) openSheet(t); }
  else if (act === "tx-del") deleteFromRow(a);
  else if (act === "close") closeSheet();
  // The paperclip. Each file box opens inside the tap, so the phone allows it. Android asks camera or gallery
  // first: Chrome there leaves the camera out of a picker that takes several photos. iPhones offer both anyway.
  else if (act === "attach") { if (isAndroid) $("#attachMenu").hidden = !$("#attachMenu").hidden; else $("#f-file").click(); }
  else if (act === "attach-cam") { $("#attachMenu").hidden = true; $("#f-cam").click(); }
  else if (act === "attach-pick") { $("#attachMenu").hidden = true; $("#f-file").click(); }
  else if (act === "interest") askInterest();
  else if (act === "for-who") { forWho = a.dataset.who; $("#f-err").textContent = ""; applyFor(); }
  else if (act === "to-who") {
    toWho = a.dataset.who;
    $("#f-err").textContent = "";
    $("#f-towho").querySelectorAll("[data-who]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.who === toWho)));
    fillTo();
  }
  else if (act === "photo-remove") { photoForm.list.splice(Number(a.dataset.i), 1); photoForm.changed = true; renderPhotos(); }
  else if (act === "photo-view") viewPhoto(photoForm.list[Number(a.dataset.i)]);
  else if (act === "cat-toggle") showCats($("#f-cats").hidden);
  else if (act === "del") deleteEntry();
  else if (act === "day") { S.selDay = a.dataset.date; draw(); }
  else if (act === "stat") { S.statType = a.dataset.type; draw(); }
  else if (act === "stat-cat") {
    // Stats: open a category's entries, or fold the open one shut.
    const k = a.dataset.cat, list = document.querySelector(".cat-tx");
    if (S.statOpen === k && list) {
      document.querySelectorAll(`.lg[data-cat="${CSS.escape(k)}"]`).forEach(b => b.setAttribute("aria-expanded", "false"));
      foldShut(list, () => { S.statOpen = null; draw(); });
    } else { S.statOpen = k; animate("statcat"); draw(); }
  }
  else if (act === "demo") { buildDemo(); S.demo = true; paint(); }
  else if (act === "exit-demo") { S.demo = false; paint(); }
  else if (act === "invite") invite();
  else if (act === "signout") S.user.signOut();
  else if (act === "signin") leaveDeviceOnly();
  else if (act === "install") install();
  else if (act === "install-later") { try { localStorage.setItem("alkansave.installHint", "off"); } catch {} drawChrome(); }
  else if (act === "csv") downloadCsv(a.dataset.scope);
  else if (act === "rec-edit") { const r = S.recurring.find(x => x.id === a.dataset.id); if (r) openRecSheet(r); }
  else if (act === "member-remove") removeMember(a.dataset.id);
  else if (act === "leave") leaveBook();
  else if (act === "filters") {
    if (S.showFilters) closeFilters(false); // folds the panel away
    else { S.showFilters = true; filterScrollFrom = scrollY; animate("filters"); draw(); }
  }
  // Focus inside the tap itself so phones bring up the keyboard right away.
  else if (act === "search-open") { S.searchOpen = true; animate("search"); draw(); const q = $("#q"); if (q) q.focus(); }
  else if (act === "search-close") { const q = $("#q"); if (q) q.blur(); S.q = ""; S.searchOpen = false; draw(); }
  else if (act === "scope") { S.f.scope = a.dataset.scope; draw(); }
  else if (act === "clear-filters") { S.q = ""; S.f = { type: "", cat: "", who: "", acct: "", scope: "month" }; draw(); }
  else if (act === "rem-on") turnOnReminders();
  else if (act === "me") {
    // Your photo opens Accounts with the Family card (members, invite, sign out) unfolded.
    if (S.view !== "accounts") animate("view");
    S.view = "accounts"; S.armed = "";
    try { localStorage.setItem("alkansave.view", S.view); } catch {}
    setFoldOpen("family", true);
    draw();
    const fam = document.querySelector('.fold-body[data-fold="family"]');
    if (fam) fam.closest(".card").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
  }
  else if (act === "undo") { const u = S.undo; S.undo = null; if (u) u(); }
  else if (act === "reload") location.reload();
  else if (act === "refresh-phone") { a.disabled = true; a.textContent = "Refreshing…"; refreshPhone(); }
  else if (act === "bal-toggle") {
    if (S.balOpen) {
      a.setAttribute("aria-expanded", "false"); // turn the arrow while the list folds
      foldShut($("#balBreak"), () => { S.balOpen = false; draw(); });
    } else { S.balOpen = true; draw(); if (!calm()) growOpen($("#balBreak")); }
  }
  else if (act === "fold") {
    const k = a.dataset.fold;
    if (foldOpen(k)) {
      a.setAttribute("aria-expanded", "false"); // turn the arrow while the card folds
      foldShut(document.querySelector(`.fold-body[data-fold="${k}"]`), () => { setFoldOpen(k, false); draw(); });
    } else { setFoldOpen(k, true); animate("fold:" + k); draw(); }
  }
  else if (act === "rem-off") turnOffReminders();
});

let noticeTimer = 0;
// `undo`, when given, adds an Undo button to the message for as long as it shows (`label` renames it, e.g.
// "Try again"). `busy` puts a spinner before the message, for something still going on, like "Saving…".
function flash(msg, ms = 8000, undo = null, { label = "Undo", busy = false } = {}) {
  S.notice = msg; S.undo = undo; S.undoLabel = label; S.noticeBusy = busy; drawChrome();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { S.notice = ""; S.undo = null; S.noticeBusy = false; drawChrome(); }, ms);
}
async function invite() {
  let url;
  try { url = await S.user.createInvite(); }
  catch { flash("Couldn't create an invite link. Check your connection and try again."); return; }
  if (navigator.share) {
    try { await navigator.share({ title: "AlkanSave", text: "Join our family budget on AlkanSave", url }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); flash("Invite link copied. Send it to your family; it works for 7 days."); }
  catch { flash(`Send this invite link to your family (it works for 7 days): ${url}`, 60000); }
}
$("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scrim").hidden) closeSheet(); });
$("#main").addEventListener("change", e => {
  const d = e.target.dataset || {};
  if (d.role) S.user.setRole(d.role, e.target.value).catch(() => { flash("Couldn't change their role. Check your connection and try again."); draw(); });
  else if (d.filter) { S.f[d.filter] = e.target.value; draw(); }
});
// Budget limits and starting balances save shortly after you stop typing, and again when you leave the box
// (each save does nothing if the amount hasn't changed). They don't wait for "change": on iPhones it never comes
// once the commas below have rewritten the box, so any amount of ₱1,000 or more was never saved.
const SAVED_BOXES = "input[data-lim], input[data-start], input[data-start-shared]";
let boxTimer = null;
function saveBox(el) {
  clearTimeout(boxTimer);
  const d = el.dataset;
  if (d.lim) saveBudget(d.lim, el.value);
  else if (d.start) saveStart(d.start, el.value);
  else if (d.startShared) saveSharedStart(d.startShared, el.value);
}
$("#main").addEventListener("input", e => {
  if (!e.target.matches(SAVED_BOXES)) return;
  clearTimeout(boxTimer);
  const el = e.target;
  boxTimer = setTimeout(() => saveBox(el), 800);
});
$("#main").addEventListener("focusout", e => { if (e.target.matches && e.target.matches(SAVED_BOXES)) saveBox(e.target); });
// Leaving the app with the keyboard still up doesn't always count as leaving the box.
addEventListener("pagehide", () => { const el = document.activeElement; if (el && el.matches && el.matches(SAVED_BOXES)) saveBox(el); });
// Commas go in while typing in any amount box; the cursor stays after the same digit it was after.
const AMOUNT_INPUTS = "#f-amount, #interest-amt, input[data-lim], input[data-start], input[data-start-shared]";
document.addEventListener("input", e => {
  const el = e.target;
  if (!el.matches || !el.matches(AMOUNT_INPUTS)) return;
  const before = el.value, after = withCommas(before);
  if (after === before) return;
  const kept = before.slice(0, el.selectionStart ?? before.length).replace(/[^\d.-]/g, "").length;
  let pos = 0;
  for (let seen = 0; pos < after.length && seen < kept; pos++) if (/[\d.-]/.test(after[pos])) seen++;
  el.value = after;
  el.setSelectionRange(pos, pos);
});
// Backspace just after a comma deletes the digit before it (the comma alone would only come straight back).
document.addEventListener("beforeinput", e => {
  const el = e.target;
  if (e.inputType !== "deleteContentBackward" || !el.matches || !el.matches(AMOUNT_INPUTS)) return;
  const c = el.selectionStart;
  if (c && c === el.selectionEnd && el.value[c - 1] === ",") el.setSelectionRange(c - 1, c - 1);
});
// Typing in search only redraws the results, so the search box keeps focus and the keyboard stays up.
$("#main").addEventListener("input", e => {
  if (e.target.id !== "q") return;
  S.q = e.target.value;
  const r = $("#results");
  if (r) r.innerHTML = transBody();
});
$("#main").addEventListener("keydown", e => { if (e.key === "Enter" && (e.target.id === "q" || (e.target.dataset && (e.target.dataset.lim || e.target.dataset.start)))) e.target.blur(); });
$("#main").addEventListener("focusout", () => { setTimeout(() => { if (pending) draw(); }, 0); });

// ---------- Boot ----------
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
fillAccounts();
draw();
// Counts only the time spent opening the book, not time on the sign-in screens (.gate, from auth.js).
let waited = 0;
const stallWatch = setInterval(() => {
  if (S.loaded || S.demo) { clearInterval(stallWatch); return; }
  if (document.querySelector(".gate")) { waited = 0; return; }
  if ((waited += 1000) >= STALL_MS && !S.openTrouble) { S.openTrouble = "slow"; hideSplash(); draw(); }
}, 1000);
(async () => {
  const { db, user, local, canSignIn } = await connect();
  S.user = user;
  S.local = local;
  S.canSignIn = !!canSignIn;
  if (user) user.onChange(paint);
  if (user) {
    const [id, cw, own] = await Promise.all([user.id(), user.can("data.write"), user.isOwner()]);
    S.meId = id; S.canWrite = cw !== false; S.isOwner = own;
    user.reminders.state().then(st => { S.rem = st; draw(); if (st === "on") user.reminders.refresh(); });
  } else {
    S.meId = "local"; S.canWrite = true;
  }
  S.db = db;
  S.db.collection("tx").onSnapshot(snap => {
    S.tx = snap.docs.map(d => clean(d.id, d.data())).filter(Boolean);
    S.loaded = true;
    S.live = snap.metadata.fromCache ? "offline" : snap.metadata.hasPendingWrites ? "saving" : "live";
    paint();
    hideSplash();
  }, () => { S.live = "error"; S.loaded = true; paint(); hideSplash(); });
  S.db.doc("config/budgets").onSnapshot(snap => {
    S.budgets = cleanLimits(snap.exists ? snap.data().limits : null);
    draw();
  }, () => {});
  // Starting balances saved before they were per person (and, without sign-in, the only ones).
  S.db.doc("config/accounts").onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    S.legacyStart = cleanStarts(d && d.start);
    S.legacyStartBy = d && d.updatedBy;
    draw();
  }, () => {});
  S.db.doc("config/shared").onSnapshot(snap => {
    S.sharedStart = snap.exists ? cleanStarts(snap.data().start) : null;
    draw();
  }, () => {});
  S.db.collection("recurring").onSnapshot(snap => {
    S.recurring = snap.docs.map(d => cleanRec(d.id, d.data())).filter(Boolean);
    S.recLoaded = true;
    draw();
    postRecurring();
  }, () => {});
  // A phone left open overnight still adds bills that fall due when it's reopened.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) postRecurring(); });
})().catch(x => {
  console.error("AlkanSave couldn't open the book:", x);
  if (!S.loaded) { S.openTrouble = "failed"; hideSplash(); draw(); }
});
