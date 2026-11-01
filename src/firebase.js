// Firebase setup. Without the VITE_FIREBASE_* env vars the app runs in device-only mode.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseEnabled = Object.values(config).every(Boolean);

let services = null;
export function firebase() {
  if (!services) {
    const app = initializeApp(config);
    services = {
      auth: getAuth(app),
      // Keeps a copy on the phone so the book opens and accepts entries offline, then syncs.
      fs: initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
    };
  }
  return services;
}
