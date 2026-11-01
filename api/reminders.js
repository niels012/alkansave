// Daily bill reminders. Vercel Cron calls this at 8:00 AM Philippine time (see vercel.json).
// For each family book with bills due tomorrow, sends one notification to every phone of every
// member that turned reminders on (households/{hid}/members/{uid}/devices/{id}).
//
// Needs two Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  the service account key JSON from Firebase (Project settings → Service accounts)
//   CRON_SECRET               any long random string; Vercel Cron sends it, and so must a manual call
// Manual test: GET /api/reminders?date=YYYY-MM-DD with "Authorization: Bearer <CRON_SECRET>"
// sends the reminders for bills due on that date.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { billsDueOn, reminderText, manilaDate } from "./_due.js";

const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

function admin() {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return { db: getFirestore(), fcm: getMessaging() };
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT is not set" });

  const asked = String(req.query.date || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : manilaDate(1);
  const { db, fcm } = admin();
  const report = { date, households: 0, phones: 0, sent: 0, removed: 0, failed: 0 };

  for (const h of (await db.collection("households").get()).docs) {
    const recurring = (await h.ref.collection("recurring").where("active", "==", true).get()).docs.map(d => d.data());
    const due = billsDueOn(recurring, date);
    if (!due.length) continue;

    const devices = [];
    for (const m of (await h.ref.collection("members").get()).docs) {
      for (const d of (await m.ref.collection("devices").get()).docs) if (d.get("token")) devices.push(d);
    }
    if (!devices.length) continue;
    report.households++;
    report.phones += devices.length;

    const { title, body } = reminderText(due);
    const result = await fcm.sendEachForMulticast({
      tokens: devices.map(d => d.get("token")),
      // Data only: the app's service worker shows the notification itself (src/sw.js).
      data: { title, body, url: "/#budget", tag: `bills-${date}` },
      webpush: { headers: { Urgency: "high", TTL: "43200" } }
    });
    const cleanup = [];
    result.responses.forEach((r, i) => {
      if (r.success) report.sent++;
      else if (DEAD_TOKEN.has(r.error && r.error.code)) { report.removed++; cleanup.push(devices[i].ref.delete()); }
      else report.failed++;
    });
    await Promise.all(cleanup);
  }

  res.status(200).json(report);
}
