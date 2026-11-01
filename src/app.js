import { connect } from "./data/index.js";

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
  editing: null, delArmed: false
};
try { const h = location.hash.slice(1); if (VIEWS.includes(h)) S.view = h; } catch {}
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
  live.lastElementChild.textContent = { live: "Live · synced", saving: "Saving…", connecting: "Connecting…", error: "Sync paused", preview: "Sample data", local: "Saved on this device" }[ls] || "Connecting…";

  let b = "";
  if (S.demo) b = `<div class="banner"><span>You're looking at sample data. Nothing you add here is saved.</span><button type="button" data-act="exit-demo">Back to our book</button></div>`;
  else if (!S.canWrite) b = `<div class="banner warn"><span>View only. Ask the owner to share this page with you as an Editor so you can log entries.</span></div>`;
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
  const hint = (!S.demo && S.isOwner) ? `<div class="hint">To add your family, open this page's Share menu and invite them by email as <b>Editor</b>. They log in on their own phone and see every entry live.</div>` : "";
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
  const seg = `<div class="bar-row"><div class="seg" role="group" aria-label="Layout"><button type="button" data-view="daily" aria-pressed="${S.view === "daily"}">Daily</button><button type="button" data-view="calendar" aria-pressed="${S.view === "calendar"}">Calendar</button></div></div>`;
  if (!S.demo && S.db && !S.loaded) return seg + `<div class="empty"><p>Opening your family book…</p></div>`;
  if (!S.demo && S.db && S.loaded && S.tx.length === 0) {
    return seg + `<div class="empty"><h2>Your family book is empty</h2><p>Tap + to log your first expense. ${S.local ? "Entries are saved on this device for now." : "Everyone in your family sees it on their phone right away."}</p><button class="btn" type="button" data-act="demo">Preview with sample data</button></div>` + familyCard();
  }
  const mt = monthTx();
  let body;
  if (S.view === "calendar") body = calendar(mt);
  else if (!mt.length) body = `<div class="empty"><h2>Nothing logged in ${esc(monthLabel(S.month))}</h2><p>Tap + to add an entry for this month.</p></div>`;
  else {
    const byDay = {};
    [...mt].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
    body = Object.keys(byDay).map(d => dayGroup(d, byDay[d])).join("");
  }
  return seg + familyCard() + body;
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
  return head + `<section class="card">${rows}</section>`;
}

function viewAccounts() {
  const all = txAll();
  const bal = k => all.reduce((a, t) => {
    if (t.type === "income" && t.acct === k) return a + t.amount;
    if (t.type === "expense" && t.acct === k) return a - t.amount;
    if (t.type === "transfer") { if (t.acct === k) a -= t.amount; if (t.to === k) a += t.amount; }
    return a;
  }, 0);
  const rows = ACCOUNTS.map(a => ({ ...a, b: bal(a.k) }));
  const assets = rows.filter(r => r.b > 0).reduce((s, r) => s + r.b, 0);
  const liab = rows.filter(r => r.b < 0).reduce((s, r) => s + r.b, 0);
  return `<section class="card"><div class="acct-sum"><div><span>Assets</span><b class="num inc">${peso(assets)}</b></div><div><span>Owed</span><b class="num exp">${peso(-liab)}</b></div><div><span>Net</span><b class="num">${peso(assets + liab)}</b></div></div></section>
    <section class="card"><span class="label">Balances from every entry logged</span>${rows.map(r => `<div class="acct"><span class="ico" style="--c:${r.c}" aria-hidden="true">${r.e}</span><div><div class="nm">${esc(r.n)}</div><div class="sub">${esc(r.sub)}</div></div><span class="num ${r.b < 0 ? "exp" : r.b > 0 ? "inc" : ""}">${peso(r.b)}</span></div>`).join("")}</section>
    <p class="meta">Balances start at ₱0 in this prototype. Log an "Other income" entry to set an account's starting amount.</p>`;
}

// ---------- Entry sheet ----------
const sheet = $("#sheet");
function fillAccounts() {
  const opts = ACCOUNTS.map(a => `<option value="${a.k}">${esc(a.n)}</option>`).join("");
  $("#f-acct").innerHTML = opts; $("#f-to").innerHTML = opts;
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
  if (!tr) renderCats(type, sel || (CATS[type][0] && CATS[type][0].k));
}
function openSheet(t) {
  S.editing = t ? t.id : null; S.delArmed = false;
  $("#sheetTitle").textContent = t ? "Edit entry" : "New entry";
  $("#f-err").textContent = "";
  const del = $("#f-del"); del.hidden = !t; del.classList.remove("armed"); del.textContent = "Delete";
  const today = todayISO();
  const defDate = S.view === "calendar" ? S.selDay : (today.slice(0, 7) === S.month ? today : `${S.month}-01`);
  setType(t ? t.type : "expense", t ? t.cat : null);
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
function closeSheet() { $("#scrim").hidden = true; S.editing = null; $("#fab").focus(); }

sheet.addEventListener("change", e => { if (e.target.name === "type") setType(e.target.value); });
sheet.addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#f-err");
  const type = sheet.querySelector('input[name="type"]:checked').value;
  const amount = parseFloat(String($("#f-amount").value).replace(/[₱,\s]/g, ""));
  const date = $("#f-date").value;
  const acct = $("#f-acct").value, to = $("#f-to").value;
  const catEl = sheet.querySelector('input[name="cat"]:checked');
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
    const ref = prev ? S.db.collection("tx").doc(prev.id) : S.db.collection("tx").doc();
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
  if (code === "invalid_argument" || code === "not_granted") { S.canWrite = false; drawChrome(); return "This page is view-only for you. Ask the owner to share it with you as an Editor."; }
  if (code === "quota_exceeded") return "The family book is full. Delete some old entries, then try again.";
  if (code === "resource_exhausted") return "Too many saves at once. Wait a moment and try again.";
  return "Couldn't save just now. Check your connection and try again.";
}

async function deleteEntry() {
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

// ---------- Events ----------
document.addEventListener("click", e => {
  const v = e.target.closest("[data-view]");
  if (v) { S.view = v.dataset.view; try { localStorage.setItem("alkansave.view", S.view); } catch {} draw(); window.scrollTo(0, 0); return; }
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
});
$("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scrim").hidden) closeSheet(); });
$("#main").addEventListener("change", e => { const k = e.target.dataset && e.target.dataset.lim; if (k) { saveBudget(k, e.target.value); } });
$("#main").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.lim) e.target.blur(); });
$("#main").addEventListener("focusout", () => { setTimeout(() => { if (pending) draw(); }, 0); });

// ---------- Boot ----------
fillAccounts();
draw();
(async () => {
  const { db, user, local } = await connect();
  S.user = user;
  S.local = local;
  if (user) {
    const [id, cw, own] = await Promise.all([user.id(), user.can("data.write"), user.isOwner()]);
    S.meId = id; S.canWrite = cw !== false; S.isOwner = own;
  } else {
    S.meId = "local"; S.canWrite = true;
  }
  S.db = db;
  S.db.collection("tx").onSnapshot(snap => {
    S.tx = snap.docs.map(d => clean(d.id, d.data())).filter(Boolean);
    S.loaded = true;
    S.live = snap.metadata.hasPendingWrites ? "saving" : "live";
    paint();
  }, () => { S.live = "error"; S.loaded = true; paint(); });
  S.db.doc("config/budgets").onSnapshot(snap => {
    S.budgets = cleanLimits(snap.exists ? snap.data().limits : null);
    draw();
  }, () => {});
})();
