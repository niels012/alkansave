// When a recurring bill or income falls in a month. Shared by the app (adding each month's entry, "next" dates)
// and the daily reminder job (api/_due.js), so both always agree on the day.
//   { day }                   that date each month; the 29th–31st fall on the last day of shorter months
//   { day, week, weekday }    the first…fourth (week 1–4) or last (week 5) Sunday…Saturday (weekday 0–6);
//                             day is then just the date it was first set up on
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

export const WEEKS = ["first", "second", "third", "fourth", "last"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const byWeekday = r => r.week >= 1 && r.week <= 5 && r.weekday >= 0 && r.weekday <= 6;

// Day of the month (1–31) the item falls on in month m (1–12) of year y.
export function dueDay(r, y, m) {
  const last = daysIn(y, m);
  if (!byWeekday(r)) return Math.min(r.day, last);
  if (r.week === 5) return last - (dow(y, m, last) - r.weekday + 7) % 7;
  return 1 + (r.weekday - dow(y, m, 1) + 7) % 7 + (r.week - 1) * 7;
}

// "2026-12" → "2026-12-07"
export function dueDate(r, month) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(dueDay(r, y, m)).padStart(2, "0")}`;
}

// The ways an item first dated `date` ("2026-11-03") can repeat: on that date, on that weekday of that week
// ("first Tuesday"), and, when it's the last such weekday of its month, on the last one.
export function patternsFor(date) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = dow(y, m, d), out = [{ day: d }];
  if (d <= 28) out.push({ day: d, week: Math.ceil(d / 7), weekday });
  if (d + 7 > daysIn(y, m)) out.push({ day: d, week: 5, weekday });
  return out;
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
// "3rd", "29th (or the last day)", "first Tuesday": read as "on the …" / "… of each month".
export function repeatLabel(r) {
  if (byWeekday(r)) return `${WEEKS[r.week - 1]} ${WEEKDAYS[r.weekday]}`;
  return r.day >= 29 ? `${ordinal(r.day)} (or the last day)` : ordinal(r.day);
}
