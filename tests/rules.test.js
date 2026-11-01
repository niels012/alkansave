// Firestore security rules tests. Run with: npm run test:rules (needs Java for the emulator).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
const HID = "fam1";
const profile = { name: "Ana", color: "#1F55D0", avatarUrl: "" };
const tx = (by, extra = {}) => ({
  type: "expense", amountCents: 12550, date: "2026-11-01", cat: "food", acct: "cash", to: null,
  note: "Lunch", by, createdAt: 1767225600000, updatedAt: 0, updatedBy: null, ...extra
});
const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "alkansave-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
  });
});
after(() => env.cleanup());

// owner "ana", editor "ben", viewer "cy"; "eve" is a stranger. Invite "invitecode1234" is valid, "oldinvite12345" expired.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", HID), { name: "Ana's family", ownerId: "ana", createdAt: Timestamp.now() });
    await setDoc(doc(db, "households", HID, "members", "ana"), { role: "owner", ...profile, joinedAt: Timestamp.now() });
    await setDoc(doc(db, "households", HID, "members", "ben"), { role: "editor", ...profile, name: "Ben", joinedAt: Timestamp.now() });
    await setDoc(doc(db, "households", HID, "members", "cy"), { role: "viewer", ...profile, name: "Cy", joinedAt: Timestamp.now() });
    await setDoc(doc(db, "households", HID, "tx", "t1"), tx("ana"));
    await setDoc(doc(db, "invites", "invitecode1234"), { hid: HID, householdName: "Ana's family", createdBy: "ana", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 864e5) });
    await setDoc(doc(db, "invites", "oldinvite12345"), { hid: HID, householdName: "Ana's family", createdBy: "ana", createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  });
});

// ---------- Reading ----------
test("members can read the book; strangers and signed-out visitors cannot", async () => {
  await assertSucceeds(getDoc(doc(as("ben"), "households", HID, "tx", "t1")));
  await assertSucceeds(getDoc(doc(as("cy"), "households", HID, "tx", "t1")));
  await assertFails(getDoc(doc(as("eve"), "households", HID, "tx", "t1")));
  await assertFails(getDoc(doc(as("eve"), "households", HID)));
  await assertFails(getDoc(doc(anon(), "households", HID, "tx", "t1")));
});

// ---------- Entries ----------
test("owner and editor can add entries as themselves", async () => {
  await assertSucceeds(setDoc(doc(as("ben"), "households", HID, "tx", "t2"), tx("ben")));
  await assertSucceeds(setDoc(doc(as("ana"), "households", HID, "tx", "t3"), tx("ana")));
});

test("nobody can add an entry in someone else's name", async () => {
  await assertFails(setDoc(doc(as("ben"), "households", HID, "tx", "t2"), tx("ana")));
});

test("viewers and strangers cannot add entries", async () => {
  await assertFails(setDoc(doc(as("cy"), "households", HID, "tx", "t2"), tx("cy")));
  await assertFails(setDoc(doc(as("eve"), "households", HID, "tx", "t2"), tx("eve")));
});

test("entries must be well formed", async () => {
  const db = as("ben");
  const bad = [
    tx("ben", { amountCents: 0 }),
    tx("ben", { amountCents: 12.5 }),
    tx("ben", { type: "loan" }),
    tx("ben", { date: "1 Nov 2026" }),
    tx("ben", { note: "x".repeat(201) }),
    tx("ben", { type: "transfer", to: null }),
    tx("ben", { extra: true })
  ];
  for (const [i, d] of bad.entries()) await assertFails(setDoc(doc(db, "households", HID, "tx", "bad" + i), d));
  await assertSucceeds(setDoc(doc(db, "households", HID, "tx", "ok"), tx("ben", { type: "transfer", cat: "transfer", to: "bank" })));
});

test("editing keeps the original author and records the editor", async () => {
  const ref = doc(as("ben"), "households", HID, "tx", "t1");
  await assertSucceeds(setDoc(ref, tx("ana", { amountCents: 9900, updatedAt: 1767229200000, updatedBy: "ben" })));
  await assertFails(setDoc(ref, tx("ben", { updatedAt: 1767229200000, updatedBy: "ben" })));
  await assertFails(setDoc(ref, tx("ana", { updatedAt: 1767229200000, updatedBy: "ana" })));
});

test("editors can delete entries; viewers cannot", async () => {
  await assertFails(deleteDoc(doc(as("cy"), "households", HID, "tx", "t1")));
  await assertSucceeds(deleteDoc(doc(as("ben"), "households", HID, "tx", "t1")));
});

// ---------- Budgets ----------
test("editors can set budgets; viewers cannot; only the budgets doc is writable", async () => {
  const limits = { food: 4000, pet: 1200 };
  await assertSucceeds(setDoc(doc(as("ben"), "households", HID, "config", "budgets"), { limits, updatedAt: 1, updatedBy: "ben" }));
  await assertFails(setDoc(doc(as("cy"), "households", HID, "config", "budgets"), { limits, updatedAt: 1, updatedBy: "cy" }));
  await assertFails(setDoc(doc(as("ben"), "households", HID, "config", "other"), { limits, updatedAt: 1, updatedBy: "ben" }));
});

// ---------- Creating a household ----------
test("anyone signed in can create their own household as owner", async () => {
  const db = as("eve");
  const b = writeBatch(db);
  b.set(doc(db, "households", "fam2"), { name: "Eve's family", ownerId: "eve", createdAt: serverTimestamp() });
  b.set(doc(db, "households", "fam2", "members", "eve"), { role: "owner", ...profile, joinedAt: serverTimestamp() });
  b.set(doc(db, "users", "eve"), { householdId: "fam2", updatedAt: 1 });
  await assertSucceeds(b.commit());
});

test("nobody can create a household owned by someone else", async () => {
  await assertFails(setDoc(doc(as("eve"), "households", "fam2"), { name: "x", ownerId: "ana", createdAt: serverTimestamp() }));
});

test("nobody can make themselves owner of an existing household", async () => {
  await assertFails(setDoc(doc(as("eve"), "households", HID, "members", "eve"), { role: "owner", ...profile, joinedAt: serverTimestamp() }));
});

// ---------- Invites ----------
test("a valid invite lets someone join as editor", async () => {
  await assertSucceeds(setDoc(doc(as("eve"), "households", HID, "members", "eve"),
    { role: "editor", ...profile, joinedAt: serverTimestamp(), inviteCode: "invitecode1234" }));
});

test("expired, missing or wrong-household invites are refused", async () => {
  const join = code => setDoc(doc(as("eve"), "households", HID, "members", "eve"),
    { role: "editor", ...profile, joinedAt: serverTimestamp(), inviteCode: code });
  await assertFails(join("oldinvite12345"));
  await assertFails(join("nosuchinvite12"));
  await assertFails(setDoc(doc(as("eve"), "households", HID, "members", "eve"), { role: "editor", ...profile, joinedAt: serverTimestamp() }));
});

test("an invite can't be used to join as owner or for someone else", async () => {
  await assertFails(setDoc(doc(as("eve"), "households", HID, "members", "eve"),
    { role: "owner", ...profile, joinedAt: serverTimestamp(), inviteCode: "invitecode1234" }));
  await assertFails(setDoc(doc(as("eve"), "households", HID, "members", "zed"),
    { role: "editor", ...profile, joinedAt: serverTimestamp(), inviteCode: "invitecode1234" }));
});

test("only the owner can create invites, and they can't be listed", async () => {
  const inv = by => ({ hid: HID, householdName: "Ana's family", createdBy: by, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * 864e5) });
  await assertSucceeds(setDoc(doc(as("ana"), "invites", "newinvite123456"), inv("ana")));
  await assertFails(setDoc(doc(as("ben"), "invites", "beninvite123456"), inv("ben")));
  await assertFails(setDoc(doc(as("ana"), "invites", "short"), inv("ana")));
  await assertFails(setDoc(doc(as("ana"), "invites", "longinvite12345"), { ...inv("ana"), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 864e5) }));
  const { collection, getDocs } = await import("firebase/firestore");
  await assertFails(getDocs(collection(as("eve"), "invites")));
});

// ---------- Members ----------
test("members can change their own name but not their own role", async () => {
  const ref = doc(as("cy"), "households", HID, "members", "cy");
  await assertSucceeds(updateDoc(ref, { name: "Cyrus" }));
  await assertFails(updateDoc(ref, { role: "editor" }));
});

test("the owner can change other members' roles and remove them", async () => {
  await assertSucceeds(updateDoc(doc(as("ana"), "households", HID, "members", "cy"), { role: "editor" }));
  await assertFails(updateDoc(doc(as("ana"), "households", HID, "members", "cy"), { role: "owner" }));
  await assertFails(updateDoc(doc(as("ben"), "households", HID, "members", "cy"), { role: "editor" }));
  await assertSucceeds(deleteDoc(doc(as("ana"), "households", HID, "members", "ben")));
});

test("members can leave; the owner can't leave their own book", async () => {
  await assertSucceeds(deleteDoc(doc(as("cy"), "households", HID, "members", "cy")));
  await assertFails(deleteDoc(doc(as("ana"), "households", HID, "members", "ana")));
});

// ---------- Users ----------
test("people can only read and write their own user doc", async () => {
  await assertSucceeds(setDoc(doc(as("ben"), "users", "ben"), { householdId: HID, updatedAt: 1 }));
  await assertFails(getDoc(doc(as("eve"), "users", "ben")));
  await assertFails(setDoc(doc(as("eve"), "users", "ben"), { householdId: HID, updatedAt: 1 }));
});
