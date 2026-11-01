// Firebase web config from VITE_FIREBASE_* env vars. Kept apart from the Firebase SDK so the app
// can check whether sync is set up without downloading the SDK (it's loaded later, in data/index.js).
const required = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseEnabled = Object.values(required).every(Boolean);

// Bill reminders also need the sender id and the Web Push key (Project settings → Cloud Messaging).
export const firebaseConfig = { ...required, messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID };
export const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
export const remindersEnabled = firebaseEnabled && !!firebaseConfig.messagingSenderId && !!vapidKey;
