// Bill reminders on this phone: notification permission, the Firebase Cloud Messaging token, and the
// device record (households/{hid}/members/{uid}/devices/{id}) the daily job in api/reminders.js sends to.
// Loaded on demand from auth.js, so the messaging SDK isn't part of the first download.
import { getMessaging, getToken, deleteToken, isSupported } from "firebase/messaging";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { firebase } from "./firebase.js";
import { vapidKey, remindersEnabled } from "./config.js";
import { store } from "./prefs.js";
import { isIOS, isStandalone } from "./device.js";

const ON = "alkansave.reminders";
const DEVICE = "alkansave.deviceId";
const TOKEN = "alkansave.reminderToken";

function deviceId() {
  let id = store.get(DEVICE);
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join(""); store.set(DEVICE, id); }
  return id;
}
const platform = () => isIOS ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : "web";
const deviceRef = (hid, uid) => doc(firebase().fs, "households", hid, "members", uid, "devices", deviceId());

// The service worker is only registered in the built app; don't wait forever for it elsewhere.
const workerReady = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error("no service worker")), 10000))
]);

async function currentToken() {
  return getToken(getMessaging(firebase().app), { vapidKey, serviceWorkerRegistration: await workerReady() });
}

// "unavailable" | "needs-install" | "unsupported" | "denied" | "on" | "off"
export async function reminderState() {
  if (!remindersEnabled) return "unavailable";
  if (isIOS && !isStandalone()) return "needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && store.get(ON) === "1" ? "on" : "off";
}

// `permission` is the promise from Notification.requestPermission(), started in the tap handler
// itself because iPhones only allow the prompt directly from a tap.
export async function enableReminders(hid, uid, permission) {
  const result = await permission;
  if (result !== "granted") return result === "denied" ? "denied" : "off";
  const token = await currentToken();
  await setDoc(deviceRef(hid, uid), { token, platform: platform(), updatedAt: Date.now() });
  store.set(ON, "1");
  store.set(TOKEN, token);
  return "on";
}

export async function disableReminders(hid, uid) {
  store.del(ON);
  await deleteDoc(deviceRef(hid, uid)).catch(() => {});
  await deleteToken(getMessaging(firebase().app)).catch(() => {});
  store.del(TOKEN);
  return "off";
}

// Tokens can change; on each launch make sure the saved one is current.
export async function refreshReminders(hid, uid) {
  if ((await reminderState()) !== "on") return;
  const token = await currentToken();
  if (token && token !== store.get(TOKEN)) {
    await setDoc(deviceRef(hid, uid), { token, platform: platform(), updatedAt: Date.now() });
    store.set(TOKEN, token);
  }
}
