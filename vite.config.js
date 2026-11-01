import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Builds dist/sw.js from src/sw.js with the list of built files to save for offline use.
// The version is a hash of those file names, so the service worker updates whenever the app does.
const serviceWorker = {
  name: "alkansave-service-worker",
  apply: "build",
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter(f => f.startsWith("assets/")).sort().map(f => "/" + f);
    const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
    const source = readFileSync("src/sw.js", "utf8")
      .replace("__VERSION__", version)
      .replace("__PRECACHE__", JSON.stringify(files));
    this.emitFile({ type: "asset", fileName: "sw.js", source });
  }
};

export default defineConfig({
  plugins: [serviceWorker]
});
