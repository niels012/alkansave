// Tests for which bills get a reminder and what it says. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { billsDueOn, reminderText, manilaDate } from "../api/_due.js";

const bill = (extra = {}) => ({ type: "expense", amountCents: 1450000, cat: "bills", acct: "bank", note: "Rent", day: 5, active: true, ...extra });

test("a bill is due on its day of the month", () => {
  assert.equal(billsDueOn([bill()], "2026-12-05").length, 1);
  assert.equal(billsDueOn([bill()], "2026-12-04").length, 0);
});

test("bills set for the 29th–31st are due on the last day of shorter months", () => {
  const b = bill({ day: 31 });
  assert.equal(billsDueOn([b], "2026-11-30").length, 1);
  assert.equal(billsDueOn([b], "2027-02-28").length, 1);
  assert.equal(billsDueOn([b], "2028-02-29").length, 1); // leap year
  assert.equal(billsDueOn([b], "2028-02-28").length, 0);
  assert.equal(billsDueOn([b], "2026-12-30").length, 0);
});

test("income and stopped items get no reminder", () => {
  assert.equal(billsDueOn([bill({ type: "income" }), bill({ active: false })], "2026-12-05").length, 0);
});

test("one bill: name, amount and account", () => {
  assert.deepEqual(reminderText([bill()]), { title: "Due tomorrow: Rent", body: "₱14,500 from Bank" });
  assert.equal(reminderText([bill({ note: "", cat: "pet" })]).title, "Due tomorrow: Pet");
});

test("several bills: count and total, biggest first", () => {
  const due = billsDueOn([bill({ note: "Internet", amountCents: 169900 }), bill()], "2026-12-05");
  assert.deepEqual(reminderText(due), {
    title: "2 bills due tomorrow · ₱16,199",
    body: "Rent ₱14,500 · Internet ₱1,699"
  });
});

test("dates are Philippine time", () => {
  // 2026-11-30 17:00 UTC is already Dec 1, 1 AM in Manila; "tomorrow" there is Dec 2.
  const now = Date.UTC(2026, 10, 30, 17, 0);
  assert.equal(manilaDate(0, now), "2026-12-01");
  assert.equal(manilaDate(1, now), "2026-12-02");
});
