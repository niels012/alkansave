// The AlkanSave logo screen (#splash in index.html). It's in the page itself so it shows before any
// code loads; it fades out once the family book is ready, or when a sign-in/setup screen needs the room.
const el = () => document.getElementById("splash");

export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains("gone")) return;
  s.classList.add("gone");
  s.addEventListener("transitionend", () => { if (s.classList.contains("gone")) s.hidden = true; }, { once: true });
  setTimeout(() => { if (s.classList.contains("gone")) s.hidden = true; }, 400); // in case the transition doesn't run
}

// Never leave someone staring at the logo: after 10 seconds the app shows its own "Opening…" message.
let safety = 0;
const arm = () => { clearTimeout(safety); safety = setTimeout(hideSplash, 10000); };

export function showSplash() {
  const s = el();
  if (!s) return;
  s.hidden = false;
  s.classList.remove("gone");
  arm();
}

arm();
