// Firestore with the same calls app.js makes on localDb(): collection("tx"), doc("config/budgets"),
// onSnapshot / set / delete. Amounts are stored as whole centavos and handed to the app as pesos.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from "firebase/firestore";

export const toStored = d => {
  const { amount, ...rest } = d;
  return { ...rest, amountCents: Math.round(amount * 100) };
};
const fromStored = d => {
  const { amountCents, ...rest } = d;
  return { ...rest, amount: (amountCents || 0) / 100 };
};

// Firestore only confirms a write once the server has it. Offline (or on a slow connection) the entry
// is already saved on the phone and shows up right away, so stop waiting rather than keep the form open.
// A rejected write still rolls back in the live listener.
const settle = p => {
  p.catch(e => console.warn("AlkanSave sync:", e));
  return navigator.onLine === false ? Promise.resolve() : Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
};

export function firestoreDb(fs, hid) {
  const base = `households/${hid}`;
  const txCol = collection(fs, base, "tx");
  const docRef = ref => ({
    set: d => settle(setDoc(ref, ref.parent.id === "tx" ? toStored(d) : d)),
    delete: () => settle(deleteDoc(ref))
  });
  return {
    collection: () => ({
      doc: id => docRef(id ? doc(txCol, id) : doc(txCol)),
      onSnapshot: (cb, err) => onSnapshot(txCol, { includeMetadataChanges: true }, s => cb({
        docs: s.docs.map(d => ({ id: d.id, data: () => fromStored(d.data()) })),
        metadata: { hasPendingWrites: s.metadata.hasPendingWrites, fromCache: s.metadata.fromCache }
      }), err)
    }),
    doc: path => {
      const ref = doc(fs, base, path);
      return {
        ...docRef(ref),
        onSnapshot: (cb, err) => onSnapshot(ref, s => cb({ exists: s.exists(), data: () => s.data() }), err)
      };
    }
  };
}
