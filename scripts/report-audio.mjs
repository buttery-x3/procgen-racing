import { readFile, writeFile } from "node:fs/promises";
import { audioVersion } from "./audio-version.mjs";

const args = process.argv.slice(2);
const browserArg = args.find((arg) => arg.startsWith("--browser="));
const browserPath = browserArg?.slice("--browser=".length) || "artifacts/audio-browser.json";
if (args.some((arg) => !arg.startsWith("--browser=")))
  throw new Error("Usage: npm run report:audio -- --browser=artifacts/audio-browser.json");
const browser = JSON.parse(await readFile(browserPath, "utf8"));
const sourceHash = audioVersion();
if (browser.format !== "procgen-racing:audio-qualification" || browser.version !== 1)
  throw new Error("Expected an exported audio-lab qualification report.");
if (browser.sourceHash !== sourceHash)
  throw new Error(`Audio source changed: report ${browser.sourceHash}; current ${sourceHash}. Restart Vite and rerun the lab.`);
if (!browser.offline?.checks?.length || browser.offline.failed !== 0 || browser.offline.checks.some((check) => !check.passed))
  throw new Error("Complete and pass the browser OfflineAudioContext checks before publishing.");
if (!browser.sampleRates?.includes(44100) || !browser.sampleRates?.includes(48000))
  throw new Error("Audio evidence must include 44.1 and 48 kHz renders.");
const stress = browser.stress;
if (!stress?.completed || stress.targetSeconds < 1200 || stress.elapsedSeconds < 1207 || stress.audioOnSeconds < 1199 || stress.visibleFraction < 0.98 || !stress.finite)
  throw new Error("Complete a visible 20-minute 1920×1080 audio stress run before publishing; interrupted runs remain local evidence.");
if (stress.drawingBuffer?.width !== 1920 || stress.drawingBuffer?.height !== 1080)
  throw new Error("Audio stress evidence must use the 1920×1080 drawing buffer.");
if (!browser.runtimeSmoke?.checks?.length || browser.runtimeSmoke.failed !== 0 || browser.runtimeSmoke.checks.some((check) => !check.passed))
  throw new Error("Complete and pass the live runtime lifecycle smoke checks before publishing.");
const target = "docs/research/audio-qualification.json";
await writeFile(target, `${JSON.stringify(browser, null, 2)}\n`);
console.log(JSON.stringify({ target, sourceHash, offlineChecks: browser.offline.checks.length, stressSeconds: stress.elapsedSeconds, humanListening: browser.humanListening }));
