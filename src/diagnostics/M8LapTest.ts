import "../style.css";
import "../workbench/m6.css";
import "../workbench/first-pass.css";
import { App } from "../app/App";
import { SoloStorage } from "../storage/SoloStorage";
import { referenceControls } from "./ReferenceDriver";
import { validateGhost } from "../storage/SoloStorage";
let driving = false;
const app = new App({ deterministic: true,
  storage: new SoloStorage("procgen-racing:m8-qualification"),
  driver: (t, s, c) =>
    driving
      ? referenceControls(t, s, c, 14)
      : { throttle: 0, brake: 1, steer: 0 },
  onLap: (lap) => {
    if (!lap.result.valid) return;
    driving = false;
    const ghost = lap.ghost
      ? validateGhost(lap.ghost, lap.result.identity)
      : undefined;
    document.querySelector("#qualification-status")!.textContent =
      `Physical lap complete · ${lap.result.duration.toFixed(3)} s · ${lap.result.valid ? "valid" : "invalid"} · ghost ${ghost ? "validated" : "not a new best"}`;
    (
      document.querySelector("#qualification-json") as HTMLTextAreaElement
    ).value = JSON.stringify(
      {
        scope:
          "Production App, Workbench, 120 Hz four-wheel physics, conservative scripted VehicleControls, real gates and limits, isolated qualification IndexedDB.",
        result: lap.result,
        ghost: ghost && {
          samples: ghost.samples.length / 24,
          bytes: ghost.samples.byteLength,
          duration: ghost.duration,
        },
      },
      null,
      2,
    );
  },
});
await app.initialize(document.querySelector<HTMLElement>("#app")!);
document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-action], [data-session]",
  );
  if (
    target?.dataset.action === "session:trial" ||
    target?.dataset.session === "trial"
  )
    driving = true;
});
window.addEventListener("pagehide", () => app.dispose(), { once: true });
