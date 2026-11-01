// Picks the data source for the app. Phase 3 adds Firestore here; app.js stays the same.
import { localDb } from "./local.js";

export async function connect() {
  return { db: localDb(), user: null, local: true };
}
