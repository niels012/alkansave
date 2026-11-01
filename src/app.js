import { connect } from "./data/index.js";
import { leaveDeviceOnly } from "./prefs.js";
import { isIOS, isStandalone } from "./device.js";

// ---------- Reference data ----------
const CATS = {
  expense: [
    { k: "food", n: "Food", e: "🍜", c: "#E0734F" },
    { k: "groceries", n: "Groceries", e: "🛒", c: "#4C9A66" },
    { k: "transport", n: "Transport", e: "🚌", c: "#4B7BC8" },
    { k: "bills", n: "Bills & Utilities", e: "💡", c: "#C29A1E" },
    { k: "household", n: "Household", e: "🏠", c: "#8C69BD" },
    { k: "kids", n: "Kids & School", e: "🎒", c: "#D35B89" },
    { k: "health", n: "Health", e: "💊", c: "#2A9F9C" },
    { k: "shopping", n: "Shopping", e: "🛍️", c: "#B3643A" },
    { k: "leisure", n: "Leisure", e: "🎬", c: "#6E8B36" },
    { k: "padala", n: "Padala & Family", e: "💌", c: "#A07A50" },
    { k: "pet", n: "Pet", e: "🐾", c: "#3E8BB0" },
    { k: "other", n: "Other", e: "📦", c: "#7A8882" }
  ],
  income: [
    { k: "salary", n: "Salary", e: "💼", c: "#2A5EC3" },
    { k: "business", n: "Business", e: "🏪", c: "#3F8F7A" },
    { k: "bonus", n: "13th Month & Bonus", e: "🎁", c: "#9A6BC2" },
    { k: "gift", n: "Gifts", e: "🧧", c: "#C9573F" },
    { k: "other_in", n: "Other income", e: "➕", c: "#7A8882" }
  ]
};
const TRANSFER = { k: "transfer", n: "Transfer", e: "🔁", c: "#7A8882" };
const ACCOUNTS = [
  { k: "cash", n: "Cash", e: "💵", c: "#4C9A66", sub: "Wallet & coin jar" },
  { k: "gcash", n: "GCash", e: "📱", c: "#2F6FD6", sub: "E-wallet" },
  { k: "maya", n: "Maya", e: "📲", c: "#2A9F9C", sub: "E-wallet" },
  { k: "bank", n: "Bank", e: "🏦", c: "#8C69BD", sub: "Savings / payroll" },
  { k: "card", n: "Credit card", e: "💳", c: "#C94233", sub: "Shows what you owe" }
];
const catOf = (type, k) => type === "transfer" ? TRANSFER : (CATS[type] || CATS.expense).find(c => c.k === k) || (type === "income" ? CATS.income.find(c => c.k === "other_in") : CATS.expense.find(c => c.k === "other"));
const acctOf = k => ACCOUNTS.find(a => a.k === k) || ACCOUNTS[0];
const VIEWS = ["daily", "calendar", "stats", "budget", "accounts"];

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const peso = n => fmt.format(Math.round((n || 0) * 100) / 100);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shiftMonth = (m, d) => { const [y, mo] = m.split("-").map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
const monthLabel = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" }); };
const daysIn = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };

// ---------- State ----------
const S = {
  month: todayISO().slice(0, 7), view: "daily", statType: "expense", selDay: todayISO(),
  db: null, user: null, meId: null, isOwner: false, canWrite: true,
  tx: [], budgets: {}, loaded: false, live: "connecting", profiles: {},
  demo: false, demoTx: [], demoBudgets: {}, local: false,
  editing: null, delArmed: false, notice: "", canSignIn: false,
  recurring: [], recLoaded: false, starts: {}, armed: "",
  editingRec: null, q: "", showFilters: false, f: { type: "", cat: "", who: "", acct: "", scope: "month" },
  rem: "", remBusy: false
};
try { const h = location.hash.slice(1); if (VIEWS.includes(h)) S.view = h; } catch {}
// A tapped bill reminder opens "/#budget" in an already-open app.
addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== S.view) { S.view = h; draw(); } });
try { const v = localStorage.getItem("alkansave.view"); if (!location.hash && VIEWS.includes(v)) S.view = v; } catch {}

const txAll = () => S.demo ? S.demoTx : S.tx;
const budgets = () => S.demo ? S.demoBudgets : S.budgets;
const monthTx = () => txAll().filter(t => t.date.slice(0, 7) === S.month);

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
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null
  };
}
function cleanLimits(l) {
  const out = {};
  if (l && typeof l === "object") for (const c of CATS.expense) { const v = Number(l[c.k]); if (v > 0 && v < 1e10) out[c.k] = v; }
  return out;
}
function cleanStarts(s) {
  const out = {};
  if (s && typeof s === "object") for (const a of ACCOUNTS) { const v = Number(s[a.k]); if (v && Math.abs(v) < 1e10) out[a.k] = v; }
  return out;
}
function cleanRec(id, d) {
  if (!d || !["expense", "income"].includes(d.type) || !(Number(d.amount) > 0)) return null;
  return {
    id, type: d.type, amount: Number(d.amount),
    cat: String(d.cat || "other"), acct: String(d.acct || "cash"), note: String(d.note || "").slice(0, 200),
    day: Math.min(31, Math.max(1, Math.round(Number(d.day)) || 1)),
    lastPosted: /^\d{4}-\d{2}$/.test(String(d.lastPosted || "")) ? d.lastPosted : todayISO().slice(0, 7),
    active: d.active !== false, createdBy: typeof d.createdBy === "string" ? d.createdBy : null, createdAt: Number(d.createdAt) || 0
  };
}
// The fields a recurring doc is saved with (no id).
const recData = r => ({ type: r.type, amount: r.amount, cat: r.cat, acct: r.acct, note: r.note, day: r.day, lastPosted: r.lastPosted, active: r.active, createdBy: r.createdBy, createdAt: r.createdAt });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
const recWhen = day => day >= 29 ? `${ordinal(day)} (or the last day)` : ordinal(day);
// When a recurring item will next be added, as "Dec 1".
const recNext = r => { const m = shiftMonth(r.lastPosted, 1); return new Date(`${m}-${pad(Math.min(r.day, daysIn(m)))}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" }); };
const parseAmount = raw => Math.round((parseFloat(String(raw).replace(/[₱,\s]/g, "")) || 0) * 100) / 100;

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
function avatar(id, sm) {
  const p = who(id);
  const initials = esc((p.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase());
  return `<span class="av${sm ? " sm" : ""}" style="--c:${esc(p.color)}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : initials}</span>`;
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
function buildDemo() {
  const m = S.month, last = m === todayISO().slice(0, 7) ? Number(todayISO().slice(8)) : daysIn(m);
  const rows = [
    [1, "income", "salary", 32000, "bank", "a", "Sahod, 1st cutoff"],
    [1, "expense", "bills", 14500, "bank", "a", "Rent"],
    [2, "expense", "groceries", 3860, "card", "b", "Weekly groceries"],
    [2, "expense", "transport", 180, "cash", "a", "Jeep & tricycle"],
    [3, "expense", "food", 265, "gcash", "b", "Merienda with the kids"],
    [4, "expense", "kids", 1450, "gcash", "b", "School project materials"],
    [5, "expense", "bills", 3120, "gcash", "a", "Electric bill"],
    [6, "expense", "groceries", 940, "cash", "b", "Palengke run"],
    [7, "expense", "leisure", 1680, "card", "a", "Family dinner out"],
    [8, "transfer", null, 5000, "bank", "a", "Pay credit card", "card"],
    [9, "expense", "bills", 1699, "card", "a", "Internet"],
    [10, "expense", "padala", 3000, "gcash", "b", "Padala to Nanay"],
    [11, "expense", "health", 820, "cash", "b", "Vitamins & meds"],
    [12, "expense", "transport", 420, "maya", "a", "Ride home in the rain"],
    [13, "expense", "groceries", 2275, "card", "b", "Weekly groceries"],
    [14, "expense", "household", 1190, "maya", "b", "Detergent & cleaning stuff"],
    [15, "income", "salary", 32000, "bank", "a", "Sahod, 2nd cutoff"],
    [15, "income", "business", 6400, "gcash", "b", "Online baking orders"],
    [16, "expense", "bills", 480, "gcash", "a", "Water bill"],
    [17, "expense", "food", 540, "cash", "a", "Lunch at work"],
    [18, "expense", "shopping", 2350, "card", "b", "School shoes"],
    [19, "expense", "groceries", 1120, "cash", "b", "Palengke run"],
    [20, "transfer", null, 2000, "bank", "b", "Cash for the week", "cash"],
    [21, "expense", "kids", 600, "cash", "b", "Baon for the week"],
    [22, "expense", "food", 389, "gcash", "a", "Coffee & pandesal"],
    [23, "expense", "transport", 1500, "cash", "a", "Gas"],
    [24, "expense", "pet", 850, "gcash", "b", "Dog food"]
  ];
  S.demoTx = rows.filter(r => r[0] <= last).map((r, i) => ({
    id: "demo" + i, type: r[1], amount: r[3], date: `${m}-${pad(r[0])}`, cat: r[1] === "transfer" ? "transfer" : r[2],
    acct: r[4], to: r[7] || null, note: r[6], by: "demo-" + r[5], createdAt: Date.now() - (last - r[0]) * 86400000 - i * 600000, updatedAt: 0, updatedBy: null
  }));
  S.demoBudgets = { food: 4000, groceries: 9000, transport: 3000, bills: 21000, household: 2000, kids: 3500, health: 1500, shopping: 2500, leisure: 2000, padala: 3000, pet: 1200 };
}

// ---------- Rendering ----------
let pending = false;
function draw() {
  const active = document.activeElement;
  if (active && active.closest && active.closest("#main input")) { pending = true; drawChrome(); return; }
  pending = false;
  drawChrome();
  const main = $("#main");
  const v = S.view;
  // Until the book has loaded, say so rather than showing empty months.
  if (!S.demo && !S.loaded) { main.innerHTML = `<div class="empty"><p>Opening your family book…</p></div>`; return; }
  main.innerHTML = v === "stats" ? viewStats() : v === "budget" ? viewBudget() : v === "accounts" ? viewAccounts() : viewTrans();
}
function paint() { draw(); refreshProfiles(); }

function drawChrome() {
  $("#monthLabel").textContent = monthLabel(S.month);
  const mt = monthTx();
  const inc = mt.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const exp = mt.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  $("#sum").innerHTML = `<div><span>Income</span><b class="num inc">${peso(inc)}</b></div><div><span>Expenses</span><b class="num exp">${peso(exp)}</b></div><div><span>Balance</span><b class="num">${peso(inc - exp)}</b></div>`;

  const live = $("#live");
  const ls = S.demo ? "preview" : S.local ? "local" : S.live;
  live.dataset.s = ls;
  live.lastElementChild.textContent = { live: "Live · synced", saving: "Saving…", connecting: "Connecting…", error: "Sync paused", preview: "Sample data", local: "Saved on this device", offline: "Offline · saved on phone" }[ls] || "Connecting…";

  let b = "";
  if (S.notice) b = `<div class="banner"><span class="notice">${esc(S.notice)}</span></div>`;
  else if (S.demo) b = `<div class="banner"><span>You're looking at sample data. Nothing you add here is saved.</span><button type="button" data-act="exit-demo">Back to our book</button></div>`;
  else if (!S.canWrite) b = `<div class="banner warn"><span>View only. Ask the book's owner to make you an Editor so you can log entries.</span></div>`;
  else if (installOffer() && !installHintOff()) b = `<div class="banner">${installText()}<span class="banner-actions">${installOffer() === "prompt" ? `<button type="button" data-act="install">Install</button>` : ""}<button type="button" class="ghost" data-act="install-later">${installOffer() === "prompt" ? "Not now" : "Got it"}</button></span></div>`;
  $("#bannerWrap").innerHTML = b;

  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.view === S.view || (t.dataset.view === "daily" && S.view === "calendar");
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  $("#fab").hidden = !(S.demo || S.canWrite);
}

function familyCard() {
  const mt = monthTx().filter(t => t.type === "expense");
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

function txRow(t) {
  const c = catOf(t.type, t.cat);
  const p = who(t.by);
  const sub = t.type === "transfer" ? `${acctOf(t.acct).n} → ${acctOf(t.to).n}${t.note ? " · " + t.note : ""}` : `${t.note ? t.note + " · " : ""}${acctOf(t.acct).n}`;
  const cls = t.type === "income" ? "inc" : t.type === "expense" ? "exp" : "";
  const ro = !(S.demo || S.canWrite);
  return `<button class="tx" type="button" data-act="edit" data-id="${esc(t.id)}"${ro ? " disabled" : ""}>
    <span class="ico" style="--c:${c.c}" aria-hidden="true">${c.e}</span>
    <span class="tx-main"><span class="tx-cat">${esc(c.n)}</span><span class="tx-sub">${esc(sub)}</span></span>
    <span class="tx-right"><span class="num ${cls}">${peso(t.amount)}</span><span class="tx-who">${avatar(t.by, true)}${esc(p.name)}</span></span>
  </button>`;
}
function dayGroup(date, list) {
  const d = new Date(date + "T00:00:00");
  const wd = d.getDay();
  const inc = list.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const exp = list.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  return `<section class="day"><div class="day-h">
    <span class="day-n num">${d.getDate()}</span>
    <span class="day-w"><span class="${wd === 0 ? "sun" : wd === 6 ? "sat" : ""}">${d.toLocaleDateString("en-PH", { weekday: "short" })}</span><span>${pad(d.getMonth() + 1)}.${d.getFullYear()}</span></span>
    <span class="num inc">${inc ? peso(inc) : ""}</span><span class="num exp">${exp ? peso(exp) : ""}</span>
  </div>${list.map(txRow).join("")}</section>`;
}

function viewTrans() {
  const n = filterCount();
  const seg = `<div class="bar-row"><div class="seg" role="group" aria-label="Layout"><button type="button" data-view="daily" aria-pressed="${S.view === "daily"}">Daily</button><button type="button" data-view="calendar" aria-pressed="${S.view === "calendar"}">Calendar</button></div>
    ${txAll().length ? `<button class="btn sm${n ? " on" : ""}" type="button" data-act="filters" aria-expanded="${S.showFilters}">Filter${n ? ` · ${n}` : ""}</button>` : ""}</div>`;
  if (!S.demo && S.tx.length === 0) {
    return seg + `<div class="empty"><h2>Your family book is empty</h2><p>Tap + to log your first expense. ${S.local ? "Entries are saved on this device for now." : "Everyone in your family sees it on their phone right away."}</p><button class="btn" type="button" data-act="demo">Preview with sample data</button></div>` + familyCard();
  }
  const search = `<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
    <input type="search" id="q" value="${esc(S.q)}" placeholder="Search notes, categories, people, amounts" autocomplete="off" enterkeyhint="search" aria-label="Search entries"></label>`;
  return seg + search + (S.showFilters ? filterPanel() : "") + `<div id="results">${transBody()}</div>`;
}

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
    <label class="field"><span>Account</span><select data-filter="acct">${opt("", "All accounts", F.acct)}${ACCOUNTS.map(a => opt(a.k, a.n, F.acct)).join("")}</select></label>
    <div class="filters-foot"><div class="seg" role="group" aria-label="Period"><button type="button" data-act="scope" data-scope="month" aria-pressed="${F.scope === "month"}">${esc(monthLabel(S.month))}</button><button type="button" data-act="scope" data-scope="all" aria-pressed="${F.scope === "all"}">All time</button></div>
      ${filtering() ? `<button class="link" type="button" data-act="clear-filters">Clear all</button>` : ""}</div>
  </div>`;
}

function searchResults() {
  const list = filteredTx().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const where = S.f.scope === "all" ? "all time" : monthLabel(S.month);
  const q = S.q.trim();
  if (!list.length) {
    return `<div class="empty"><h2>No matching entries</h2><p>Nothing in ${esc(where)} matches ${q ? `“${esc(q)}”` : "these filters"}.</p>
      ${S.f.scope === "month" ? `<button class="btn" type="button" data-act="scope" data-scope="all">Search all time</button>` : ""}</div>`;
  }
  const out = list.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  const inc = list.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const byDay = {};
  list.forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
  return `<section class="card result-sum"><span><b>${list.length}</b> ${list.length === 1 ? "entry" : "entries"} · ${esc(where)}</span>
    <span class="result-nums">${out ? `<span class="num exp">${peso(out)} spent</span>` : ""}${inc ? `<span class="num inc">${peso(inc)} in</span>` : ""}</span></section>`
    + Object.keys(byDay).map(d => dayGroup(d, byDay[d])).join("");
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
    [...mt].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
    body = Object.keys(byDay).map(d => dayGroup(d, byDay[d])).join("");
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
    cells += `<button type="button" class="cell${date === today ? " today" : ""}" data-act="day" data-date="${date}" aria-pressed="${date === S.selDay}" aria-label="${d} ${esc(monthLabel(S.month))}${exp ? ", spent " + peso(exp) : ""}">
      <span class="d num">${d}</span>${inc ? `<span class="v num inc">${peso(inc)}</span>` : ""}${exp ? `<span class="v num exp">${peso(exp)}</span>` : ""}</button>`;
  }
  const trailing = (7 - ((first + n) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells += `<span class="cell out" aria-hidden="true"></span>`;
  const sel = mt.filter(t => t.date === S.selDay).sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="cal"><div class="cal-g">${cells}</div></div>` + (sel.length ? dayGroup(S.selDay, sel) : `<p class="meta">Nothing logged on ${new Date(S.selDay + "T00:00:00").toLocaleDateString("en-PH", { month: "long", day: "numeric" })}.</p>`);
}

function donut(parts, total, label) {
  const r = 64, C = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map(p => { const len = total ? (p.v / total) * C : 0; const s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"/>`; off += len; return s; }).join("");
  return `<svg viewBox="0 0 160 160" role="img" aria-label="${esc(label)}"><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="22"/>${segs}
    <text x="80" y="76" text-anchor="middle" style="fill:var(--muted);font-family:var(--body)" font-size="11">Total</text>
    <text x="80" y="95" text-anchor="middle" style="fill:var(--ink)" font-size="16" class="donut-mid">${esc(peso(total))}</text></svg>`;
}

function viewStats() {
  const type = S.statType;
  const mt = monthTx().filter(t => t.type === type);
  const total = mt.reduce((a, t) => a + t.amount, 0);
  const seg = `<div class="bar-row"><div class="seg" role="group" aria-label="Show"><button type="button" data-act="stat" data-type="expense" aria-pressed="${type === "expense"}">Expenses</button><button type="button" data-act="stat" data-type="income" aria-pressed="${type === "income"}">Income</button></div></div>`;
  if (!mt.length) return seg + `<div class="empty"><h2>No ${type === "expense" ? "expenses" : "income"} in ${esc(monthLabel(S.month))}</h2><p>Stats fill in as your family logs entries.</p></div>`;
  const byCat = {};
  mt.forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const parts = Object.entries(byCat).map(([k, v]) => ({ ...catOf(type, k), v })).sort((a, b) => b.v - a.v);
  const legend = parts.map(p => `<div class="lg" style="--c:${p.c}"><span class="pct num">${Math.round(p.v / total * 100)}%</span><span class="n">${p.e} ${esc(p.n)}</span><span class="num">${peso(p.v)}</span></div>`).join("");
  const byWho = {};
  mt.forEach(t => { const k = t.by || "unknown"; byWho[k] = (byWho[k] || 0) + t.amount; });
  const max = Math.max(...Object.values(byWho));
  const whoRows = Object.entries(byWho).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<div class="who-row">${avatar(id === "unknown" ? null : id)}<span class="nm">${esc(who(id === "unknown" ? null : id).name)}</span><span class="num">${peso(v)}</span><div class="meter"><i style="width:${(v / max * 100).toFixed(1)}%;--c:${esc(who(id === "unknown" ? null : id).color)}"></i></div></div>`).join("");
  return seg + `<section class="card"><span class="label">By category</span><div class="donut-wrap">${donut(parts, total, `${type} by category`)}<div class="legend">${legend}</div></div></section>
    <section class="card"><span class="label">${type === "expense" ? "Who spent" : "Who earned"} · ${esc(monthLabel(S.month))}</span>${whoRows}</section>`;
}

function viewBudget() {
  const lim = budgets();
  const mt = monthTx().filter(t => t.type === "expense");
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
    const foot = l ? `<span class="num">${peso(s)} spent</span><span class="${state(s, l)} num">${s > l ? peso(s - l) + " over" : peso(l - s) + " left"}</span>` : `<span class="num">${s ? peso(s) + " spent" : "No spending yet"}</span><span>No limit</span>`;
    return `<div class="bud"><span class="ico" style="--c:${c.c}" aria-hidden="true">${c.e}</span><div class="bud-body">
      <div class="bud-line"><span class="nm">${esc(c.n)}</span><label class="limit"><span>₱</span><input id="lim-${c.k}" data-lim="${c.k}" inputmode="numeric" value="${l || ""}" placeholder="No limit" aria-label="Monthly limit for ${esc(c.n)}"${editable ? "" : " disabled"}></label></div>
      ${l ? `<div class="meter"><i style="width:${pct.toFixed(1)}%;--c:${barColor(s, l)}"></i></div>` : ""}
      <div class="bud-foot">${foot}</div></div></div>`;
  }).join("");
  return head + `<section class="card">${rows}</section>` + recurringSection() + reminderSection();
}

// ---------- Bill reminders ----------
// Sent by api/reminders.js at 8 AM the day before a recurring expense is due.
const REMINDER_TIME = "8 AM";
function nextReminder() {
  const today = todayISO();
  let best = null;
  for (const r of S.recurring) {
    if (!r.active || r.type !== "expense") continue;
    for (const m of [today.slice(0, 7), shiftMonth(today.slice(0, 7), 1)]) {
      const due = `${m}-${pad(Math.min(r.day, daysIn(m)))}`;
      const d = new Date(due + "T00:00:00"); d.setDate(d.getDate() - 1);
      const remind = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (remind > today) { if (!best || remind < best.remind) best = { remind, due, r }; break; }
    }
  }
  return best;
}
function reminderSection() {
  if (S.demo || !S.user || !S.rem || S.rem === "unavailable") return "";
  const bills = S.recurring.filter(r => r.active && r.type === "expense").length;
  const day = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  const msg = {
    "needs-install": `On iPhone, reminders only work in the installed app. Tap ${SHARE_ICON} <b>Share</b> → <b>Add to Home Screen</b>, open AlkanSave from your Home Screen, and turn them on there.`,
    unsupported: "This browser can't show reminders. Open AlkanSave in Chrome, or install it to your Home Screen.",
    denied: "Notifications are blocked for AlkanSave on this phone. Allow them in your phone's settings for this app (or the browser's site settings), then reopen AlkanSave.",
    off: `Get a notification at ${REMINDER_TIME} the day before each repeating bill is due.`,
    on: `On for this phone. You'll get a notification at ${REMINDER_TIME} the day before each repeating bill is due.`
  }[S.rem] || "";
  const next = S.rem === "on" && nextReminder();
  const none = (S.rem === "on" || S.rem === "off") && !bills;
  const button = S.rem === "off" ? `<button class="btn primary" type="button" data-act="rem-on"${S.remBusy ? " disabled" : ""}>${S.remBusy ? "Turning on…" : "Turn on reminders"}</button>`
    : S.rem === "on" ? `<button class="btn" type="button" data-act="rem-off"${S.remBusy ? " disabled" : ""}>Turn off</button>` : "";
  return `<section class="card"><span class="label">Bill reminders${S.rem === "on" ? " · On" : ""}</span>
    <p class="meta">${msg}</p>
    ${next ? `<p class="meta">Next: <b>${day(next.remind)}</b>, for ${esc(next.r.note || catOf("expense", next.r.cat).n)} (due ${day(next.due)}).</p>` : ""}
    ${none ? `<p class="meta">Reminders are for bills set to repeat every month. Tick <b>Repeat every month</b> when you log rent, Meralco or internet.</p>` : ""}
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
  const list = S.recurring.filter(r => r.active).sort((a, b) => a.day - b.day);
  const rows = list.map(r => {
    const c = catOf(r.type, r.cat);
    return `<button class="rec" type="button" data-act="rec-edit" data-id="${esc(r.id)}"${S.canWrite ? "" : " disabled"}>
      <span class="ico" style="--c:${c.c}" aria-hidden="true">${c.e}</span>
      <span class="rec-main"><span class="nm">${esc(r.note || c.n)}</span><span class="sub">${esc(c.n)} · ${recWhen(r.day)} of each month · ${esc(acctOf(r.acct).n)}</span></span>
      <span class="num ${r.type === "income" ? "inc" : "exp"}">${peso(r.amount)}</span></button>`;
  }).join("");
  return `<section class="card"><span class="label">Recurring every month</span>
    ${rows || `<p class="meta">Rent, Meralco, internet or a salary can add themselves every month. When you log one, tick <b>Repeat every month</b>.</p>`}
    ${rows ? `<p class="meta">Each is added automatically on its day. ${S.canWrite ? "Tap one to change its amount or day, or to stop it." : ""}</p>` : ""}</section>`;
}

function viewAccounts() {
  const all = txAll();
  const starts = S.demo ? {} : S.starts;
  const bal = k => all.reduce((a, t) => {
    if (t.type === "income" && t.acct === k) return a + t.amount;
    if (t.type === "expense" && t.acct === k) return a - t.amount;
    if (t.type === "transfer") { if (t.acct === k) a -= t.amount; if (t.to === k) a += t.amount; }
    return a;
  }, starts[k] || 0);
  const rows = ACCOUNTS.map(a => ({ ...a, b: bal(a.k) }));
  const assets = rows.filter(r => r.b > 0).reduce((s, r) => s + r.b, 0);
  const liab = rows.filter(r => r.b < 0).reduce((s, r) => s + r.b, 0);
  return `<section class="card"><div class="acct-sum"><div><span>Assets</span><b class="num inc">${peso(assets)}</b></div><div><span>Owed</span><b class="num exp">${peso(-liab)}</b></div><div><span>Net</span><b class="num">${peso(assets + liab)}</b></div></div></section>
    <section class="card"><span class="label">Balances</span>${rows.map(r => `<div class="acct"><span class="ico" style="--c:${r.c}" aria-hidden="true">${r.e}</span><div><div class="nm">${esc(r.n)}</div><div class="sub">${esc(r.sub)}</div></div><span class="num ${r.b < 0 ? "exp" : r.b > 0 ? "inc" : ""}">${peso(r.b)}</span></div>`).join("")}</section>`
    + startSection() + familySection() + exportSection() + installSection();
}

// What each account held before the family started logging. The card is entered as the amount owed.
function startSection() {
  if (S.demo) return "";
  const editable = S.canWrite;
  const rows = ACCOUNTS.map(a => {
    const owed = a.k === "card";
    const v = S.starts[a.k] ? (owed ? -S.starts[a.k] : S.starts[a.k]) : "";
    return `<div class="acct"><span class="ico" style="--c:${a.c}" aria-hidden="true">${a.e}</span>
      <div><div class="nm">${esc(a.n)}</div><div class="sub">${owed ? "Owed when you started" : "Had when you started"}</div></div>
      <label class="limit"><span>₱</span><input data-start="${a.k}" inputmode="decimal" value="${v}" placeholder="0" aria-label="Starting ${owed ? "amount owed on" : "balance of"} ${esc(a.n)}"${editable ? "" : " disabled"}></label></div>`;
  }).join("");
  return `<section class="card"><span class="label">Starting balances</span>
    <p class="meta">Enter what's already in each account so the balances above match real life.</p>${rows}</section>`;
}

function exportSection() {
  if (S.demo || !txAll().length) return "";
  return `<section class="card"><span class="label">Export</span>
    <p class="meta">Download entries as a CSV file for Excel or Google Sheets.</p>
    <div class="bar-row"><button class="btn" type="button" data-act="csv" data-scope="month">${esc(monthLabel(S.month))}</button><button class="btn" type="button" data-act="csv" data-scope="all">All entries</button></div></section>`;
}

function downloadCsv(scope) {
  const rows = (scope === "month" ? monthTx() : txAll()).slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  if (!rows.length) { flash(`Nothing logged in ${monthLabel(S.month)} yet.`); return; }
  // Quote text, and stop spreadsheet apps from treating a note like "=SUM(...)" as a formula.
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const name = id => (id && S.profiles[id] && S.profiles[id].name) || who(id).name;
  const lines = [["Date", "Type", "Category", "Amount (PHP)", "Account", "To account", "Note", "Logged by"].join(",")];
  for (const t of rows) {
    lines.push([
      t.date, t.type[0].toUpperCase() + t.type.slice(1), cell(catOf(t.type, t.cat).n), t.amount.toFixed(2),
      cell(acctOf(t.acct).n), t.type === "transfer" ? cell(acctOf(t.to).n) : "", cell(t.note), cell(name(t.by))
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
  return `<section class="card"><span class="label">Family · ${esc(S.user.household().name)}</span>${rows}
    ${S.isOwner ? `<div><button class="btn primary" type="button" data-act="invite">Invite family</button></div>`
      : `<p class="meta">Editors can add and change entries. View only members can look but not change anything.</p>`}
    <div class="bar-row"><span class="meta">Signed in as ${esc(S.user.email)}</span><span class="banner-actions">
      ${S.isOwner ? "" : `<button class="btn danger${leaveArmed ? " armed" : ""}" type="button" data-act="leave">${leaveArmed ? "Tap to leave" : "Leave book"}</button>`}
      <button class="btn" type="button" data-act="signout">Sign out</button></span></div></section>`;
}

// ---------- Entry sheet ----------
const sheet = $("#sheet");
function fillAccounts() {
  const opts = ACCOUNTS.map(a => `<option value="${a.k}">${esc(a.n)}</option>`).join("");
  $("#f-acct").innerHTML = opts; $("#f-to").innerHTML = opts;
  $("#f-day").innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${recWhen(i + 1)}</option>`).join("");
}
function renderCats(type, sel) {
  const list = CATS[type] || [];
  $("#f-cats").innerHTML = list.map(c => `<input type="radio" name="cat" id="cat-${c.k}" value="${c.k}"${c.k === sel ? " checked" : ""}><label for="cat-${c.k}" style="--c:${c.c}"><span class="e" aria-hidden="true">${c.e}</span>${esc(c.n)}</label>`).join("");
}
function setType(type, sel) {
  sheet.dataset.type = type;
  $("#t-" + type).checked = true;
  const tr = type === "transfer";
  $("#catWrap").hidden = tr; $("#toWrap").hidden = !tr;
  $("#acctLabel").textContent = tr ? "From account" : "Account";
  $("#repeatWrap").hidden = tr || !!S.editing || !!S.editingRec || S.demo;
  if (!tr) renderCats(type, sel || (CATS[type][0] && CATS[type][0].k));
}
// The sheet edits either an entry (date) or a recurring item (day of the month; no transfers).
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
  setType(t ? t.type : "expense", t ? t.cat : null);
  $("#f-repeat").checked = false;
  $("#f-amount").value = t ? String(t.amount) : "";
  $("#f-date").value = t ? t.date : defDate;
  $("#f-acct").value = t ? t.acct : "cash";
  $("#f-to").value = t && t.to ? t.to : "bank";
  $("#f-note").value = t ? t.note : "";
  const meta = $("#f-meta");
  if (t) { meta.hidden = false; meta.textContent = `Logged by ${who(t.by).name}${t.createdAt ? " · " + ago(t.createdAt) : ""}${t.updatedAt && t.updatedBy ? ` · last edited by ${who(t.updatedBy).name}` : ""}`; }
  else meta.hidden = true;
  $("#scrim").hidden = false;
  setTimeout(() => $("#f-amount").focus(), 30);
}
function openRecSheet(r) {
  S.editing = null; S.editingRec = r.id; S.delArmed = false;
  setSheetMode(true);
  $("#sheetTitle").textContent = "Edit recurring";
  $("#f-err").textContent = "";
  const del = $("#f-del"); del.hidden = false; del.classList.remove("armed"); del.textContent = "Stop repeating";
  setType(r.type, r.cat);
  $("#f-amount").value = String(r.amount);
  $("#f-day").value = String(r.day);
  $("#f-acct").value = r.acct;
  $("#f-note").value = r.note;
  const meta = $("#f-meta");
  meta.hidden = false;
  meta.textContent = `Set up by ${who(r.createdBy).name} · next added ${recNext(r)}. Changes apply from then on; entries already added stay as they are.`;
  $("#scrim").hidden = false;
  setTimeout(() => $("#f-amount").focus(), 30);
}
function closeSheet() { $("#scrim").hidden = true; S.editing = null; S.editingRec = null; $("#fab").focus(); }

async function saveRecurringEdit(type, amount, catEl) {
  const err = $("#f-err");
  if (!(amount > 0) || amount > 1e9) { err.textContent = "Enter an amount greater than ₱0."; $("#f-amount").focus(); return; }
  if (!catEl) { err.textContent = "Pick a category."; return; }
  const r = S.recurring.find(x => x.id === S.editingRec);
  if (!r) { closeSheet(); return; }
  const next = recData({
    ...r, type, amount: Math.round(amount * 100) / 100, cat: catEl.value, acct: $("#f-acct").value,
    note: $("#f-note").value.trim().slice(0, 120), day: Number($("#f-day").value)
  });
  const btn = $("#f-save"); btn.disabled = true;
  try {
    await writeWithRetry(() => S.db.collection("recurring").doc(r.id).set(next));
    closeSheet();
    flash(`Updated. Next one is added ${recNext(next)}.`);
  } catch (x) { err.textContent = writeError(x); }
  finally { btn.disabled = false; }
}

sheet.addEventListener("change", e => { if (e.target.name === "type") setType(e.target.value); });
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
  if (type === "transfer" && acct === to) { err.textContent = "Choose two different accounts for a transfer."; return; }
  if (type !== "transfer" && !catEl) { err.textContent = "Pick a category."; return; }
  const prev = S.editing ? txAll().find(t => t.id === S.editing) : null;
  const me = S.demo ? "demo-a" : S.meId;
  const data = {
    type, amount: Math.round(amount * 100) / 100, date,
    cat: type === "transfer" ? "transfer" : catEl.value, acct, to: type === "transfer" ? to : null,
    note: $("#f-note").value.trim().slice(0, 120),
    by: prev ? prev.by : me, createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: prev ? Date.now() : 0, updatedBy: prev ? me : null
  };
  if (data.date.slice(0, 7) !== S.month) S.month = data.date.slice(0, 7);
  if (S.view === "calendar") S.selDay = data.date;
  if (S.demo) {
    const row = { id: prev ? prev.id : "demo" + Date.now(), ...data };
    S.demoTx = prev ? S.demoTx.map(t => t.id === prev.id ? row : t) : [...S.demoTx, row];
    closeSheet(); paint(); return;
  }
  const btn = $("#f-save"); btn.disabled = true;
  try {
    let ref = prev ? S.db.collection("tx").doc(prev.id) : S.db.collection("tx").doc();
    if (!prev && type !== "transfer" && $("#f-repeat").checked) {
      // This entry is the first month; later months are added by postRecurring() under the same id scheme.
      const rid = newId(), month = date.slice(0, 7);
      await writeWithRetry(() => S.db.collection("recurring").doc(rid).set({
        type, amount: data.amount, cat: data.cat, acct, note: data.note, day: Number(date.slice(8)),
        lastPosted: month, active: true, createdBy: me, createdAt: Date.now()
      }));
      ref = S.db.collection("tx").doc(`r_${rid}_${month}`);
      data.rec = rid;
    }
    await writeWithRetry(() => ref.set(data));
    closeSheet();
  } catch (x) { err.textContent = writeError(x); }
  finally { btn.disabled = false; }
});

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
  if (S.demo) { S.demoTx = S.demoTx.filter(t => t.id !== id); closeSheet(); paint(); return; }
  try { await writeWithRetry(() => S.db.collection("tx").doc(id).delete()); closeSheet(); }
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
let startQueue = Promise.resolve();
function saveStart(k, raw) {
  const v = parseAmount(raw) * (k === "card" ? -1 : 1);
  if ((S.starts[k] || 0) === v) return;
  if (v) S.starts[k] = v; else delete S.starts[k];
  const start = { ...S.starts };
  startQueue = startQueue.then(() => writeWithRetry(() => S.db.doc("config/accounts").set({ start, updatedAt: Date.now(), updatedBy: S.meId }))).catch(x => { flash(writeError(x)); draw(); });
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
        const date = `${next}-${pad(Math.min(r.day, daysIn(next)))}`;
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
document.addEventListener("click", e => {
  const v = e.target.closest("[data-view]");
  if (v) { S.view = v.dataset.view; S.armed = ""; try { localStorage.setItem("alkansave.view", S.view); } catch {} draw(); window.scrollTo(0, 0); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "prev" || act === "next") { S.month = shiftMonth(S.month, act === "prev" ? -1 : 1); draw(); }
  else if (act === "add") openSheet(null);
  else if (act === "edit") { const t = txAll().find(x => x.id === a.dataset.id); if (t) openSheet(t); }
  else if (act === "close") closeSheet();
  else if (act === "del") deleteEntry();
  else if (act === "day") { S.selDay = a.dataset.date; draw(); }
  else if (act === "stat") { S.statType = a.dataset.type; draw(); }
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
  else if (act === "filters") { S.showFilters = !S.showFilters; draw(); }
  else if (act === "scope") { S.f.scope = a.dataset.scope; draw(); }
  else if (act === "clear-filters") { S.q = ""; S.f = { type: "", cat: "", who: "", acct: "", scope: "month" }; draw(); }
  else if (act === "rem-on") turnOnReminders();
  else if (act === "rem-off") turnOffReminders();
});

let noticeTimer = 0;
function flash(msg, ms = 8000) {
  S.notice = msg; drawChrome();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { S.notice = ""; drawChrome(); }, ms);
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
  if (d.lim) saveBudget(d.lim, e.target.value);
  else if (d.start) saveStart(d.start, e.target.value);
  else if (d.role) S.user.setRole(d.role, e.target.value).catch(() => { flash("Couldn't change their role. Check your connection and try again."); draw(); });
  else if (d.filter) { S.f[d.filter] = e.target.value; draw(); }
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
  }, () => { S.live = "error"; S.loaded = true; paint(); });
  S.db.doc("config/budgets").onSnapshot(snap => {
    S.budgets = cleanLimits(snap.exists ? snap.data().limits : null);
    draw();
  }, () => {});
  S.db.doc("config/accounts").onSnapshot(snap => {
    S.starts = cleanStarts(snap.exists ? snap.data().start : null);
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
})();
