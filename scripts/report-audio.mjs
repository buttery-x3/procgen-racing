import { readFile, writeFile } from "node:fs/promises";
import { audioVersion } from "./audio-version.mjs";

const args = process.argv.slice(2);
const browserArg = args.find((arg) => arg.startsWith("--browser="));
const browserPath = browserArg?.slice("--browser=".length) || "artifacts/audio-browser.json";
const drivingArg = args.find((arg) => arg.startsWith("--driving="));
const drivingPath = drivingArg?.slice("--driving=".length) || "artifacts/audio-driving-browser.json";
if (args.some((arg) => !arg.startsWith("--browser=") && !arg.startsWith("--driving=")))
  throw new Error("Usage: npm run report:audio -- --browser=artifacts/audio-browser.json --driving=artifacts/audio-driving-browser.json");
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
if (!browser.runtimeSmoke?.checks?.length || browser.runtimeSmoke.failed !== 0 || browser.runtimeSmoke.checks.some((check) => !check.passed))
  throw new Error("Complete and pass the live runtime lifecycle smoke checks before publishing.");
const driving = JSON.parse(await readFile(drivingPath, "utf8"));
if (driving.format !== "procgen-racing:audio-driving-diagnostic" || driving.version !== 1 || driving.sourceHash !== sourceHash)
  throw new Error("Actual-app driving evidence must match the current audio source. Restart Vite and rerun audio-driving.html.");
const expectedStages = ["idle", "launch", "shift recovery", "braking", "stopped idle", "relaunch", "final braking"];
const minimumEligible = [15, 5, 10, 3, 20, 20, 3];
if (!driving.completed || !driving.firstActualUpshiftObserved || driving.errors?.length !== 0 ||
    driving.events?.some((event) => event.kind !== "first-upshift") ||
    driving.summaries?.map((summary) => summary.stage).join("|") !== expectedStages.join("|") ||
    driving.summaries.some((summary, index) => summary.eligibleSamples < minimumEligible[index] ||
      summary.nonFiniteSamples !== 0 || summary.engineSilentSamples !== 0 || summary.outputSilentSamples !== 0 ||
      summary.contextNotRunningSamples !== 0 || summary.appStalledSamples !== 0))
  throw new Error("Complete an uninterrupted actual-app launch, first shift, stop, idle, relaunch and final stop with healthy signals before publishing.");
const nodeHealth = driving.nodeHealth;
if (!nodeHealth || ["engine", "mix", "ceiling", "output", "fl/input", "fr/input", "rl/input", "rr/input"].some((name) => !nodeHealth[name]?.samples) ||
    Object.values(nodeHealth).some((health) => health.nonFiniteSamples !== 0))
  throw new Error("Actual-app driving evidence must include finite engine, wheel and output signal measurements.");
const target = "docs/research/audio-qualification.json";
const drivingTarget = "docs/research/audio-driving-qualification.json";
await writeFile(target, `${JSON.stringify(browser, null, 2)}\n`);
await writeFile(drivingTarget, `${JSON.stringify(driving, null, 2)}\n`);
console.log(JSON.stringify({ target, drivingTarget, sourceHash, offlineChecks: browser.offline.checks.length, drivingSamples: driving.samples, humanListening: browser.humanListening }));
