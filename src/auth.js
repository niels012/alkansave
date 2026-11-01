// Sign-in and family book setup, shown before the app opens (Firebase mode only).
// Resolves to { db, user, local: false }, or null when the person picks "this phone only".
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, signOut
} from "firebase/auth";
import {
  doc, getDoc, setDoc, updateDoc, writeBatch, collection, onSnapshot, serverTimestamp, Timestamp
} from "firebase/firestore";
import { firebase } from "./firebase.js";
import { firestoreDb, toStored } from "./data/firestore.js";
import { readLocal, archiveLocal } from "./data/local.js";
import { isIOS, isStandalone } from "./device.js";

const DEVICE_ONLY = "alkansave.deviceOnly";
const EMAIL = "alkansave.email";
const INVITE = "alkansave.invite";
const HID = "alkansave.hid.";
const INVITE_DAYS = 7;
const COLORS = ["#1F55D0", "#C2507F", "#2C8754", "#B3643A", "#8C69BD", "#2A9F9C", "#A26A0F"];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} }
};
const homeUrl = code => location.origin + "/" + (code ? `?invite=${encodeURIComponent(code)}` : "");
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
const colorFor = uid => COLORS[[...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const profileOf = u => ({
  name: (u.displayName || (u.email || "").split("@")[0] || "Family member").slice(0, 60),
  color: colorFor(u.uid),
  avatarUrl: (u.photoURL || "").slice(0, 500)
});

function authMessage(e) {
  const code = e && e.code;
  if (code === "auth/invalid-email" || code === "auth/missing-email") return "Enter a valid email address.";
  if (code === "auth/unauthorized-domain") return "This web address isn't allowed to sign in yet. Add it in Firebase under Authentication → Settings → Authorized domains.";
  if (code === "auth/quota-exceeded") return "Too many sign-in emails were sent today. Use Google sign-in, or try again tomorrow.";
  if (code === "auth/network-request-failed") return "No internet connection. Connect and try again.";
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") return "That sign-in link has expired or was already used. Send a new one.";
  return "Couldn't sign in. Try again.";
}

// Device-only mode is remembered so the sign-in screen doesn't return on every launch.
export function leaveDeviceOnly() { store.del(DEVICE_ONLY); location.replace(homeUrl()); }

// ---------- Screens ----------
let gateEl = null;
function screen(html) {
  if (!gateEl) {
    gateEl = document.createElement("div");
    gateEl.className = "gate";
    document.body.append(gateEl);
  }
  gateEl.innerHTML = `<div class="gate-card"><div class="brand"><img class="logo" src="/icons/mark.png" alt="" width="34" height="24">AlkanSave <small>family budget</small></div>${html}</div>`;
  return gateEl;
}
function closeGate() { if (gateEl) { gateEl.remove(); gateEl = null; } }

function confirmScreen(title, body, yes, no) {
  return new Promise(resolve => {
    const el = screen(`<h1>${esc(title)}</h1><p>${esc(body)}</p>
      <button class="btn primary wide" type="button" data-g="yes">${esc(yes)}</button>
      ${no ? `<button class="btn wide" type="button" data-g="no">${esc(no)}</button>` : ""}`);
    el.querySelector('[data-g="yes"]').onclick = () => resolve(true);
    if (no) el.querySelector('[data-g="no"]').onclick = () => resolve(false);
  });
}

function askEmail() {
  return new Promise(resolve => {
    const el = screen(`<h1>Confirm your email</h1><p>You opened a sign-in link on a different phone or browser. Enter the email it was sent to.</p>
      <form class="gate-form"><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>
      <button class="btn primary wide" type="submit">Continue</button></form>`);
    el.querySelector("form").onsubmit = ev => { ev.preventDefault(); resolve(ev.target.email.value.trim()); };
  });
}

function signInScreen(auth, note) {
  return new Promise(resolve => {
    const off = onAuthStateChanged(auth, u => { if (u) { off(); resolve(u); } });
    const invited = !!store.get(INVITE);
    const el = screen(`<h1>${invited ? "Join your family's book" : "Sign in to your family book"}</h1>
      <p>Everyone in the family signs in on their own phone and sees the same entries, live.</p>
      <button class="btn primary wide" type="button" data-g="google">Continue with Google</button>
      <div class="gate-or"><span>or</span></div>
      <form class="gate-form"><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="btn wide" type="submit">Email me a sign-in link</button></form>
      ${isIOS && isStandalone() ? `<p class="meta">On iPhone, sign-in emails open in Safari instead of this app. Use Google to sign in here.</p>` : ""}
      <p class="err" role="alert">${esc(note || "")}</p>
      ${invited ? "" : `<button class="link" type="button" data-g="local">Use on this phone only, without an account</button>`}`);
    const err = el.querySelector(".err");
    el.querySelector('[data-g="google"]').onclick = async () => {
      err.textContent = "";
      const provider = new GoogleAuthProvider();
      try { await signInWithPopup(auth, provider); }
      catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, provider);
        else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") err.textContent = authMessage(e);
      }
    };
    el.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      err.textContent = "";
      const form = ev.target, email = form.email.value.trim(), btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await sendSignInLinkToEmail(auth, email, { url: homeUrl(store.get(INVITE)), handleCodeInApp: true });
        store.set(EMAIL, email);
        form.outerHTML = `<p class="gate-ok">We sent a sign-in link to <b>${esc(email)}</b>. Open it on this phone to continue. Check your spam folder if it isn't there in a minute.</p>`;
      } catch (e) { err.textContent = authMessage(e); btn.disabled = false; }
    };
    const local = el.querySelector('[data-g="local"]');
    if (local) local.onclick = () => { off(); store.set(DEVICE_ONLY, "1"); resolve("local"); };
  });
}

// ---------- Household ----------
async function isMemberOf(fs, hid, uid) {
  try { return (await getDoc(doc(fs, "households", hid, "members", uid))).exists(); }
  catch (e) { return e.code !== "permission-denied"; } // offline: trust the household we last opened
}

async function joinWithInvite(fs, u, code, current) {
  let inv = null;
  try { const s = await getDoc(doc(fs, "invites", code)); inv = s.exists() ? s.data() : null; } catch {}
  if (!inv || inv.expiresAt.toMillis() < Date.now()) {
    await confirmScreen("This invite link has expired", "Invite links work for 7 days. Ask whoever sent it for a new one.", "Continue");
    return null;
  }
  if (inv.hid === current) return current;
  if (!(await isMemberOf(fs, inv.hid, u.uid))) {
    const ok = await confirmScreen(`Join ${inv.householdName}?`,
      current ? "You'll switch to this family book. Your current book stays as it is." : "You'll see this family's entries and can add your own.",
      "Join", "Not now");
    if (!ok) return null;
    screen(`<p class="meta">Joining ${esc(inv.householdName)}…</p>`);
    const b = writeBatch(fs);
    b.set(doc(fs, "households", inv.hid, "members", u.uid), { role: "editor", ...profileOf(u), joinedAt: serverTimestamp(), inviteCode: code });
    b.set(doc(fs, "users", u.uid), { householdId: inv.hid, updatedAt: Date.now() });
    await b.commit();
  } else {
    await setDoc(doc(fs, "users", u.uid), { householdId: inv.hid, updatedAt: Date.now() });
  }
  return inv.hid;
}

const validLocal = t => t && ["expense", "income", "transfer"].includes(t.type) && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date || "");

async function importLocal(fs, hid, uid, local) {
  const rows = Object.values(local.tx || {}).filter(validLocal);
  const txCol = collection(fs, "households", hid, "tx");
  for (let i = 0; i < rows.length; i += 400) {
    const b = writeBatch(fs);
    rows.slice(i, i + 400).forEach(t => b.set(doc(txCol), toStored({
      type: t.type, amount: t.amount, date: t.date,
      cat: String(t.cat || "other").slice(0, 30), acct: String(t.acct || "cash").slice(0, 30),
      to: t.type === "transfer" ? String(t.to || "bank").slice(0, 30) : null,
      note: String(t.note || "").slice(0, 200),
      by: uid, createdAt: Math.round(Number(t.createdAt)) || Date.now(), updatedAt: 0, updatedBy: null
    })));
    await b.commit();
  }
  const limits = local.budgets && local.budgets.limits;
  if (limits && Object.keys(limits).length) {
    await setDoc(doc(fs, "households", hid, "config", "budgets"), { limits, updatedAt: Date.now(), updatedBy: uid });
  }
  archiveLocal();
}

function createHousehold(fs, auth, u) {
  const local = readLocal();
  const n = Object.values(local.tx || {}).filter(validLocal).length;
  const first = (u.displayName || "").trim().split(/\s+/)[0];
  return new Promise(resolve => {
    const el = screen(`<h1>Start your family book</h1>
      <p>You'll be its owner. Then invite your family from the app so they can log entries from their own phones.</p>
      <form class="gate-form">
        <label class="field"><span>Book name</span><input name="name" maxlength="60" required value="${esc(first ? `${first}'s family` : "Our family")}"></label>
        ${n ? `<label class="check"><input type="checkbox" name="imp" checked> Bring over the ${n} ${n === 1 ? "entry" : "entries"} saved on this phone</label>` : ""}
        <button class="btn primary wide" type="submit">Create family book</button>
      </form>
      <p class="meta">Joining someone else's book instead? Open the invite link they sent you on this phone.</p>
      <p class="err" role="alert"></p>
      <button class="link" type="button" data-g="out">Sign out (${esc(u.email || "")})</button>`);
    const err = el.querySelector(".err");
    el.querySelector('[data-g="out"]').onclick = () => signOut(auth).then(() => location.replace(homeUrl()));
    el.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      const form = ev.target, btn = form.querySelector('button[type="submit"]');
      const name = form.name.value.trim().slice(0, 60);
      if (!name) return;
      btn.disabled = true; btn.textContent = "Creating…"; err.textContent = "";
      try {
        const hid = doc(collection(fs, "households")).id;
        const b = writeBatch(fs);
        b.set(doc(fs, "households", hid), { name, ownerId: u.uid, createdAt: serverTimestamp() });
        b.set(doc(fs, "households", hid, "members", u.uid), { role: "owner", ...profileOf(u), joinedAt: serverTimestamp() });
        b.set(doc(fs, "users", u.uid), { householdId: hid, updatedAt: Date.now() });
        await b.commit();
        if (form.imp && form.imp.checked) await importLocal(fs, hid, u.uid, local);
        resolve(hid);
      } catch {
        err.textContent = "Couldn't create the book. Check your connection and try again.";
        btn.disabled = false; btn.textContent = "Create family book";
      }
    };
  });
}

async function chooseHousehold(fs, auth, u) {
  let known = null;
  try { known = (await getDoc(doc(fs, "users", u.uid))).data()?.householdId || null; } catch {}
  known = known || store.get(HID + u.uid);
  const code = store.get(INVITE);
  if (code) {
    store.del(INVITE);
    const joined = await joinWithInvite(fs, u, code, known);
    if (joined) return joined;
  }
  if (known && await isMemberOf(fs, known, u.uid)) return known;
  return createHousehold(fs, auth, u);
}

// ---------- Session ----------
function openSession(auth, fs, u, hid) {
  store.set(HID + u.uid, hid);
  let members = {};
  const household = { id: hid, name: "" };
  const listeners = new Set();
  const changed = () => listeners.forEach(f => f());
  let ready;
  const first = new Promise(r => { ready = r; });
  let profileChecked = false;

  onSnapshot(collection(fs, "households", hid, "members"), s => {
    members = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    ready();
    changed();
    // Keep the name and photo others see in step with the sign-in account.
    const m = members[u.uid];
    if (m && !profileChecked) {
      profileChecked = true;
      const p = profileOf(u);
      if (m.name !== p.name || m.avatarUrl !== p.avatarUrl) updateDoc(doc(fs, "households", hid, "members", u.uid), { name: p.name, avatarUrl: p.avatarUrl }).catch(() => {});
    }
  }, () => ready());
  onSnapshot(doc(fs, "households", hid), s => { household.name = (s.data() && s.data().name) || ""; changed(); }, () => {});

  const role = () => (members[u.uid] && members[u.uid].role) || null;
  const user = {
    id: async () => u.uid,
    can: async () => { await first; return role() === "owner" || role() === "editor"; },
    isOwner: async () => { await first; return role() === "owner"; },
    profiles: async () => { await first; return members; },
    email: u.email || "",
    household: () => household,
    members: () => Object.entries(members).map(([id, m]) => ({ id, ...m })),
    onChange: f => listeners.add(f),
    async createInvite() {
      const code = randomCode();
      await setDoc(doc(fs, "invites", code), {
        hid, householdName: household.name || "Our family", createdBy: u.uid,
        createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 864e5)
      });
      return homeUrl(code);
    },
    async signOut() { await signOut(auth); location.replace(homeUrl()); }
  };
  return { db: firestoreDb(fs, hid), user, local: false };
}

export async function startSession() {
  const { auth, fs } = firebase();
  const code = new URL(location.href).searchParams.get("invite");
  if (code) { store.set(INVITE, code); store.del(DEVICE_ONLY); }

  let note = "";
  if (isSignInWithEmailLink(auth, location.href)) {
    const email = store.get(EMAIL) || await askEmail();
    try { await signInWithEmailLink(auth, email, location.href); store.del(EMAIL); }
    catch (e) { note = authMessage(e); }
  }
  try { await getRedirectResult(auth); } catch (e) { note = authMessage(e); }
  if (location.search) history.replaceState(null, "", "/");

  let u = await new Promise(r => { const off = onAuthStateChanged(auth, x => { off(); r(x); }); });
  if (!u) {
    if (store.get(DEVICE_ONLY) === "1") return null;
    const r = await signInScreen(auth, note);
    if (r === "local") { closeGate(); return null; }
    u = r;
  }
  screen(`<p class="meta">Opening your family book…</p>`);
  const hid = await chooseHousehold(fs, auth, u);
  closeGate();
  return openSession(auth, fs, u, hid);
}
