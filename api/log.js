// Adds one expense to a family book from another app, e.g. the meal planner's "Done Market" button.
//
// POST /api/log   Authorization: Bearer <LOG_SECRET>
//   { "id": "mp_…", "amount": 360.5, "note": "Carbon Market", "cat": "food", "acct": "cash", "date": "2026-11-05" }
//   amount is in pesos; date is optional (today in the Philippines). The same id always means the same entry,
//   so a retried request never adds it twice: the second call answers { ok: true, already: true }.
//
// The entry is logged as the AlkanSave user whose sign-in email is LOG_AS_EMAIL, in the family book they last
// opened, and only if they can edit it (owner or editor). It shows up on every family phone like any other entry.
//
// Needs these Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  already set for bill reminders
//   LOG_SECRET                any long random string; the other app sends it
//   LOG_AS_EMAIL              the email you sign in to AlkanSave with
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, timingSafeEqual } from "node:crypto";
import { manilaDate } from "./_due.js";

const KEY_RE = /^[a-z_]{2,30}$/;      // category and account keys, e.g. "food", "cash"
const ID_RE = /^[A-Za-z0-9_-]{8,60}$/;
const ALREADY_EXISTS = 6;              // gRPC status Firestore uses when create() finds the document

function admin() {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return { db: getFirestore(), auth: getAuth() };
}

function secretOk(header) {
  const secret = process.env.LOG_SECRET || "";
  const given = String(header || "").replace(/^Bearer\s+/i, "");
  if (!secret || !given) return false;
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!secretOk(req.headers.authorization)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.LOG_AS_EMAIL) {
    return res.status(500).json({ error: "not_configured", detail: "Set FIREBASE_SERVICE_ACCOUNT and LOG_AS_EMAIL in Vercel." });
  }

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = String(body.id || "");
  const amountCents = Math.round(Number(body.amount) * 100);
  const cat = String(body.cat || "other"), acct = String(body.acct || "cash");
  const note = String(body.note || "").trim().slice(0, 200);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : manilaDate(0);
  if (!ID_RE.test(id) || !(amountCents > 0 && amountCents <= 100000000000) || !KEY_RE.test(cat) || !KEY_RE.test(acct)) {
    return res.status(400).json({ error: "invalid_entry" });
  }

  try {
    const { db, auth } = admin();
    let uid;
    try { uid = (await auth.getUserByEmail(process.env.LOG_AS_EMAIL)).uid; }
    catch { return res.status(500).json({ error: "user_not_found", detail: "No AlkanSave account uses LOG_AS_EMAIL." }); }

    const hid = (await db.doc(`users/${uid}`).get()).get("householdId");
    if (!hid) return res.status(409).json({ error: "no_family_book", detail: "Open AlkanSave once and pick a family book." });
    const role = (await db.doc(`households/${hid}/members/${uid}`).get()).get("role");
    if (role !== "owner" && role !== "editor") return res.status(403).json({ error: "cannot_edit", detail: "This account can't add entries to its family book." });

    // Same fields the app writes for a new expense (see validTx in firestore.rules).
    await db.doc(`households/${hid}/tx/${id}`).create({
      type: "expense", amountCents, date, cat, acct, note,
      by: uid, createdAt: Date.now(), updatedAt: 0, updatedBy: null
    });
    return res.status(200).json({ ok: true, date });
  } catch (e) {
    if (e && e.code === ALREADY_EXISTS) return res.status(200).json({ ok: true, already: true });
    console.error("AlkanSave log:", e);
    return res.status(500).json({ error: "write_failed" });
  }
}
