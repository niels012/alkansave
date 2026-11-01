// Firebase setup. Only loaded when VITE_FIREBASE_* env vars are set (see config.js).
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { firebaseConfig } from "./config.js";

let services = null;
export function firebase() {
  if (!services) {
    const app = initializeApp(firebaseConfig);
    services = {
      app,
      auth: getAuth(app),
      // Keeps a copy on the phone so the book opens and accepts entries offline, then syncs.
      fs: initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
    };
  }
  return services;
}
