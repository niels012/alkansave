// Which recurring bills fall due on a date, and the reminder text for them.
// Used by api/reminders.js; the leading "_" keeps Vercel from serving this file as an endpoint.
import { dueDay } from "../src/schedule.js";

const CATEGORY = {
  food: "Food", groceries: "Groceries", transport: "Transport", bills: "Bills & Utilities", household: "Household",
  kids: "Kids & School", health: "Health", shopping: "Shopping", leisure: "Leisure", padala: "Padala & Family",
  tithing: "Donation", pet: "Pet", other: "Other"
};
const ACCOUNT = {
  cash: "Cash", gcash: "GCash", gotyme: "GoTyme", maribank: "MariBank", psbank: "PSBank", spaylater: "SPayLater", card: "Atome",
  maya: "Maya", bank: "Bank"
};

// "₱14,500", or "₱1,234.50" with centavos (never "₱1,234.5"), same as in the app.
const [pesoWhole, pesoCents] = [0, 2].map(d => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: d, maximumFractionDigits: d }));
const peso = cents => (cents % 100 ? pesoCents : pesoWhole).format(cents / 100);
const label = b => b.note || CATEGORY[b.cat] || "Bill";

// Today's date in the Philippines (UTC+8, no daylight saving), shifted by whole days, as "YYYY-MM-DD".
export const manilaDate = (offsetDays = 0, now = Date.now()) =>
  new Date(now + 8 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

// Same day the app adds the bill on (src/schedule.js): its date, or e.g. the first Monday of the month.
export function billsDueOn(recurring, date) {
  const [y, m, d] = date.split("-").map(Number);
  return recurring
    .filter(r => r && r.active !== false && r.type === "expense" && r.amountCents > 0 && dueDay(r, y, m) === d)
    .sort((a, b) => b.amountCents - a.amountCents);
}

// One-time entries logged ahead ("upcoming") for a date: expenses only. Entries added by a repeating bill
// (they carry its "rec") are left out: that bill already has its own reminder.
export function entriesDueOn(tx, date) {
  return tx
    .filter(t => t && t.type === "expense" && t.date === date && t.amountCents > 0 && !t.rec)
    .sort((a, b) => b.amountCents - a.amountCents);
}

// Everything to remind about for a date: repeating bills and upcoming one-time expenses, biggest first.
export const dueOn = (recurring, tx, date) =>
  [...billsDueOn(recurring, date), ...entriesDueOn(tx, date)].sort((a, b) => b.amountCents - a.amountCents);

export function reminderText(bills) {
  if (bills.length === 1) {
    const b = bills[0];
    return { title: `Due tomorrow: ${label(b)}`, body: `${peso(b.amountCents)} from ${ACCOUNT[b.acct] || "your account"}` };
  }
  const total = bills.reduce((a, b) => a + b.amountCents, 0);
  return {
    title: `${bills.length} bills due tomorrow · ${peso(total)}`,
    body: bills.map(b => `${label(b)} ${peso(b.amountCents)}`).join(" · ")
  };
}
