import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/** Feature evidence fingerprint; deliberately independent of M8 compatibility. */
export function audioVersion(root = process.cwd()) {
  const files = [
    ...readdirSync(resolve(root, "src/audio")).filter((name) => name.endsWith(".ts")).map((name) => `src/audio/${name}`),
    "src/app/App.ts",
    "src/workbench/Workbench.ts",
    "src/workbench/AudioPanel.ts",
    "src/workbench/SessionPanel.ts",
    "src/diagnostics/AudioLab.ts",
    "src/diagnostics/audioQualification.ts",
    "src/style.css",
    "audio-lab.html",
    "package-lock.json",
    "scripts/audio-version.mjs",
    "scripts/report-audio.mjs",
  ].sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(resolve(root, file));
    hash.update(file).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
