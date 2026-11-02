// Which recurring bills fall due on a date, and the reminder text for them.
// Used by api/reminders.js; the leading "_" keeps Vercel from serving this file as an endpoint.

const CATEGORY = {
  food: "Food", groceries: "Groceries", transport: "Transport", bills: "Bills & Utilities", household: "Household",
  kids: "Kids & School", health: "Health", shopping: "Shopping", leisure: "Leisure", padala: "Padala & Family",
  tithing: "Tithing", pet: "Pet", other: "Other"
};
const ACCOUNT = {
  cash: "Cash", gcash: "GCash", gotyme: "GoTyme", maribank: "MariBank", psbank: "PSBank", card: "Credit card",
  maya: "Maya", bank: "Bank"
};

const pesoFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const peso = cents => pesoFmt.format(cents / 100);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const label = b => b.note || CATEGORY[b.cat] || "Bill";

// Today's date in the Philippines (UTC+8, no daylight saving), shifted by whole days, as "YYYY-MM-DD".
export const manilaDate = (offsetDays = 0, now = Date.now()) =>
  new Date(now + 8 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

// A bill set for the 29th–31st is due on the last day of shorter months, same as when it's posted.
export function billsDueOn(recurring, date) {
  const [y, m, d] = date.split("-").map(Number);
  return recurring
    .filter(r => r && r.active !== false && r.type === "expense" && r.amountCents > 0 && Math.min(r.day, daysIn(y, m)) === d)
    .sort((a, b) => b.amountCents - a.amountCents);
}

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
