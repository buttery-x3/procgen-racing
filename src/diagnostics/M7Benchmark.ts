import { GenerationClient } from "../track/GenerationClient";
import { DEFAULT_FAMILY_RECIPE } from "../track/families/types";
import type { FamilyRecipe } from "../track/families/types";
import { DEFAULT_VENUE } from "../track/venue/types";
import { hydrateCircuit } from "../track/SurfaceCompiler";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import { initializePhysics, SuspensionRig } from "../physics/SuspensionRig";
import { SceneView } from "../rendering/SceneView";
import { REFERENCE_CARS } from "../vehicle/referenceCars";
import { Quaternion, Vector3 } from "three";
import { FIXED_STEP } from "../vehicle/types";
const style = document.createElement("style");
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#15231b;color:#d7e2c8;font:14px/1.5 system-ui}header,section{padding:24px 36px;max-width:1500px}header{display:flex;gap:24px;align-items:center;flex-wrap:wrap}h1{margin:4px 0;font-size:28px}p{color:#a9b99a}small{color:#c5da9a;letter-spacing:.12em}button{background:#cbdca8;border:0;border-radius:5px;padding:14px;font-weight:600;cursor:pointer}button:disabled{opacity:.5}label{font-size:12px}input{display:block;width:100px;padding:7px;background:#263b2b;border:1px solid #5b7251;color:#dae5ce}#scene{position:relative;width:1920px;height:1080px;overflow:hidden}#scene canvas{display:block}textarea{width:100%;height:320px;background:#102017;color:#cbdac0;border:1px solid #3b5639;font:11px monospace}pre{white-space:pre-wrap;color:#d0e0bc}`;
document.head.append(style);
const node = <T extends HTMLElement>(id: string) =>
    document.querySelector<T>(`#${id}`)!,
  button = node<HTMLButtonElement>("run"),
  status = node("status"),
  container = node("scene");
let view: SceneView | undefined, rig: SuspensionRig | undefined;
const percentile = (a: number[], p: number) =>
  [...a].sort((a, b) => a - b)[
    Math.min(a.length - 1, Math.floor(a.length * p))
  ];
const heap = () => {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  return memory
    ? {
        usedMiB: memory.usedJSHeapSize / 2 ** 20,
        totalMiB: memory.totalJSHeapSize / 2 ** 20,
        limitMiB: memory.jsHeapSizeLimit / 2 ** 20,
      }
    : null;
};
function drive(r: SuspensionRig, c: CompiledCircuit) {
  const t = r.telemetry,
    lookahead = 7 + t.speed * 0.42,
    q = new Quaternion().copy(t.rotation),
    aim = c
      .frame(t.track!.station + lookahead)
      .position.sub(new Vector3().copy(t.position)),
    angle = Math.atan2(
      aim.dot(new Vector3(-1, 0, 0).applyQuaternion(q)),
      aim.dot(new Vector3(0, 0, 1).applyQuaternion(q)),
    ),
    k = Math.max(
      ...[0, 12, 30, 55].map((d) =>
        Math.abs(c.alignment.sample(t.track!.station + d).curvature),
      ),
    ),
    target = Math.min(32, Math.sqrt((0.5 * 9.81) / Math.max(0.0001, k))),
    steer =
      (Math.atan2(2 * r.setup.wheelbase * Math.sin(angle), lookahead) /
        r.setup.steeringLimit) *
      (1 + (r.setup.speedSteering * t.speed) / 18);
  r.step({
    steer: Math.max(-1, Math.min(1, steer)),
    throttle: Math.max(0, Math.min(1, (target - t.speed) * 0.5)),
    brake: Math.max(0, Math.min(1, (t.speed - target) * 0.4)),
  });
}
async function measure(c: CompiledCircuit, frames: number) {
  const r = rig!,
    v = view!,
    intervals: number[] = [],
    sim: number[] = [],
    render: number[] = [],
    before = heap();
  let previous = 0,
    index = 0,
    accumulator = 0,
    travel = 0,
    lastStation = r.telemetry.track!.station,
    peakSurface = 0,
    peakObstacle = 0,
    peakMeshes = 0,
    peakHeap = before?.usedMiB ?? 0;
  return await new Promise<Record<string, unknown>>((resolve) => {
    const frame = (time: number) => {
      const dt = previous ? (time - previous) / 1000 : 1 / 60;
      previous = time;
      accumulator += Math.min(dt, 0.05);
      let start = performance.now();
      while (accumulator >= FIXED_STEP) {
        v.remember(r.telemetry);
        drive(r, c);
        accumulator -= FIXED_STEP;
      }
      const simMs = performance.now() - start;
      start = performance.now();
      v.render(r, accumulator / FIXED_STEP, dt);
      const renderMs = performance.now() - start;
      const delta = r.telemetry.track!.station - lastStation;
      travel += delta < -c.length / 2 ? delta + c.length : delta;
      lastStation = r.telemetry.track!.station;
      peakSurface = Math.max(peakSurface, r.streamingStats?.surfaceChunks ?? 0);
      peakObstacle = Math.max(
        peakObstacle,
        r.streamingStats?.obstacleChunks ?? 0,
      );
      peakMeshes = Math.max(peakMeshes, v.circuitStreamingStats.surfaceMeshes);
      peakHeap = Math.max(peakHeap, heap()?.usedMiB ?? 0);
      if (index >= 180) {
        intervals.push(dt * 1000);
        sim.push(simMs);
        render.push(renderMs);
      }
      index++;
      if (index % 120 === 0)
        status.textContent = `Measuring ${c.definition.familyDesign?.family}: ${Math.max(0, index - 180)} / ${frames} frames · ${Math.round(travel)} m driven`;
      if (intervals.length < frames) {
        requestAnimationFrame(frame);
        return;
      }
      const gl = v.renderer.getContext(),
        extension = gl.getExtension("WEBGL_debug_renderer_info");
      resolve({
        frameSamples: frames,
        warmupFrames: 180,
        width: v.renderer.domElement.width,
        height: v.renderer.domElement.height,
        pixelRatio: v.renderer.getPixelRatio(),
        visibility: document.visibilityState,
        frameIntervalMs: {
          p50: percentile(intervals, 0.5),
          p95: percentile(intervals, 0.95),
          max: Math.max(...intervals),
          over33ms: intervals.filter((x) => x > 33.34).length,
        },
        meanFps:
          1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
        simulationMs: { p50: percentile(sim, 0.5), p95: percentile(sim, 0.95) },
        renderSubmissionMs: {
          p50: percentile(render, 0.5),
          p95: percentile(render, 0.95),
        },
        distanceDriven: travel,
        grounded: r.telemetry.groundedCount,
        heap: { before, after: heap(), peakUsedMiB: peakHeap || null },
        renderer: {
          vendor: extension
            ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
            : gl.getParameter(gl.VENDOR),
          gpu: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          drawCalls: v.renderer.info.render.calls,
          visibleTriangles: v.renderer.info.render.triangles,
          geometries: v.renderer.info.memory.geometries,
          textures: v.renderer.info.memory.textures,
        },
        streaming: {
          peakSurface,
          peakObstacle,
          peakMeshes,
          physics: r.streamingStats,
          render: v.circuitStreamingStats,
        },
        queries: c.queryStats,
      });
    };
    requestAnimationFrame(frame);
  });
}
button.addEventListener(
  "click",
  () =>
    void (async () => {
      button.disabled = true;
      const results: Record<string, unknown>[] = [],
        client = new GenerationClient(),
        frames = Math.max(
          300,
          Math.min(3600, Number(node<HTMLInputElement>("frames").value) || 720),
        );
      try {
        await initializePhysics();
        for (const [family, targetLength] of [
          ["street", 3600],
          ["oval", 4400],
          ["endurance", 24000],
        ] as const) {
          status.textContent = `Generating ${family} · cold worker`;
          rig?.dispose();
          view?.dispose();
          container.replaceChildren();
          rig = undefined;
          view = undefined;
          const recipe: FamilyRecipe = {
              ...DEFAULT_FAMILY_RECIPE,
              seed: "m7-desktop-101",
              family,
              targetLength,
              banking: "fast",
              endurance: family === "endurance",
            },
            start = performance.now(),
            r = await client.generate(
              recipe,
              (p) => (status.textContent = `${family} · ${p.stage}`),
              { ...DEFAULT_VENUE, theme: "modern" },
            ),
            workerMs = performance.now() - start,
            c = hydrateCircuit(r.circuit),
            setup = REFERENCE_CARS.fr.setup;
          const build = performance.now();
          rig = new SuspensionRig(setup);
          rig.setCircuit(c);
          for (let i = 0; i < 360; i++) rig.step();
          view = new SceneView(container, setup, c);
          view.remember(rig.telemetry, true);
          view.setCamera("chase");
          const setupMs = performance.now() - build,
            measurement = await measure(c, frames);
          results.push({
            recipe,
            fingerprint: r.fingerprint,
            workerMs,
            setupMs,
            geometry: r.family,
            ...measurement,
          });
          node("summary").textContent = results
            .map(
              (r) =>
                `${(r.recipe as FamilyRecipe).family}: ${(r.meanFps as number).toFixed(1)} mean fps · p95 ${(r.frameIntervalMs as { p95: number }).p95.toFixed(1)} ms · ${(r.distanceDriven as number).toFixed(0)} m`,
            )
            .join("\n");
        }
        const report = {
          version: 1,
          scope:
            "Visible browser RAF; production SceneView, GenerationClient and SuspensionRig at 1920x1080, pixel ratio 1, PCF shadows, 120 Hz physics, FR reference car. Generation and setup precede warm-up. Browser scheduling and other desktop load affect results. GPU bytes are not measurable by this page.",
          date: new Date().toISOString(),
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory:
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
            null,
          results,
        };
        node<HTMLTextAreaElement>("report").value = JSON.stringify(
          report,
          null,
          2,
        );
        status.textContent =
          "Benchmark complete · all three venues measured. Copy the report below.";
      } catch (error) {
        status.textContent = String(error);
        node<HTMLTextAreaElement>("report").value = JSON.stringify(
          { error: String(error), results },
          null,
          2,
        );
      } finally {
        client.dispose();
        button.disabled = false;
      }
    })(),
);
