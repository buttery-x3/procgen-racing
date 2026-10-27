import "../style.css";
import "../workbench/m6.css";
import "../workbench/first-pass.css";
import { App } from "../app/App";
import { DEFAULT_SETUP } from "../vehicle/setup";
import { SoloStorage } from "../storage/SoloStorage";

// A deterministic fixture using the production shell, input, renderer and session.
const app = new App({ deterministic: true, setup: DEFAULT_SETUP, storage: new SoloStorage("procgen-racing:workbench-qualification") });
await app.initialize(document.querySelector<HTMLElement>("#app")!);
const qa = document.querySelector<HTMLElement>("#workbench-qa")!;
qa.style.cssText = "position:fixed;bottom:34px;right:8px;max-width:460px;max-height:45vh;overflow:auto;z-index:90;background:#172019;color:#cbd9b8;font:10px monospace;padding:6px";
const timer = window.setInterval(() => {
  document.querySelector("#workbench-state")!.textContent = JSON.stringify(app.workbenchDiagnostics(), null, 2);
}, 100);
window.addEventListener("pagehide", () => { clearInterval(timer); app.dispose(); }, { once: true });
