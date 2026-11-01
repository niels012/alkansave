// Firebase web config from VITE_FIREBASE_* env vars. Kept apart from the Firebase SDK so the app
// can check whether sync is set up without downloading the SDK (it's loaded later, in data/index.js).
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseEnabled = Object.values(firebaseConfig).every(Boolean);
