// Picks the data source for the app: the family's Firestore book when signed in,
// otherwise storage on this device. app.js uses either one through the same calls.
// The Firebase SDK is most of the app's code, so it's fetched here, after the first screen is drawn.
import { localDb } from "./local.js";
import { firebaseEnabled } from "../config.js";

export async function connect() {
  if (firebaseEnabled) {
    const { startSession } = await import("../auth.js");
    const session = await startSession();
    if (session) return session;
  }
  return { db: localDb(), user: null, local: true, canSignIn: firebaseEnabled };
}
