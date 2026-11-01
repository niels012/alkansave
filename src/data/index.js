// Picks the data source for the app: the family's Firestore book when signed in,
// otherwise storage on this device. app.js uses either one through the same calls.
import { localDb } from "./local.js";
import { firebaseEnabled } from "../firebase.js";
import { startSession } from "../auth.js";

export async function connect() {
  if (firebaseEnabled) {
    const session = await startSession();
    if (session) return session;
  }
  return { db: localDb(), user: null, local: true, canSignIn: firebaseEnabled };
}
