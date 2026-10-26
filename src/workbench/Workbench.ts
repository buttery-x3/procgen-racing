import {
  rideFrequency,
  PRESETS,
  sanitizeSetup,
  STRUCTURAL_KEYS,
} from "../vehicle/setup";
import type {
  VehicleSetup,
  VehicleTelemetry,
  NumericSetupKey,
} from "../vehicle/types";
import { Diagrams, diagramMarkup } from "./Diagrams";
import { icon } from "./icons";
import { REFERENCE_CARS } from "../vehicle/referenceCars";
import { GEAR_SETS, engineTorqueAtRpm } from "../vehicle/Powertrain";
import { getTestCircuit } from "../track/testCircuit";
import { SURFACES } from "../track/types";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type { GenerationRecipe } from "../track/generationTypes";
import { CircuitGeneratorPanel } from "./CircuitGeneratorPanel";
import { elevationPath, mapProjection, routePath } from "./CircuitMap";
import { pitOffset } from "../track/venue/geometry";
import { CarWorkshopPanel } from "./CarWorkshopPanel";
import { GaragePanel } from "./GaragePanel";
import { TracePanel } from "./TracePanel";
import { InputPanel } from "./InputPanel";
import { generateCar, carDerived } from "../vehicle/generateCar";
import { copySetup } from "../storage/GarageStorage";
import type { InputSettings } from "../input/settings";
import { loadInputSettings } from "../input/settings";
import { fingerprint } from "../vehicle/CarDefinition";

export interface WorkbenchCallbacks {
  action: (action: string) => void;
  setup: (setup: VehicleSetup, rebuild: boolean, group?: string) => void;
  generate: (recipe: GenerationRecipe) => void;
  input: (settings: InputSettings) => void;
}

interface Field {
  key: NumericSetupKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  unit: string;
  hint?: string;
}
const fields: Record<string, Field[]> = {
  powertrain: [
    {
      key: "peakTorque",
      label: "Peak engine torque",
      min: 80,
      max: 1100,
      step: 1,
      scale: 1,
      unit: "Nm",
    },
    {
      key: "redline",
      label: "Engine redline",
      min: 4500,
      max: 14000,
      step: 100,
      scale: 1,
      unit: "rpm",
    },
    {
      key: "finalDrive",
      label: "Final drive ratio",
      min: 2.5,
      max: 5.5,
      step: 0.01,
      scale: 1,
      unit: ":1",
    },
    {
      key: "diffLock",
      label: "Differential locking",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "awdFrontSplit",
      label: "AWD front torque split",
      min: 10,
      max: 90,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "brakeTorque",
      label: "Base brake torque per wheel",
      min: 800,
      max: 4500,
      step: 100,
      scale: 1,
      unit: "Nm",
      hint: "At 50:50 bias. Brake balance reallocates the same total torque.",
    },
    {
      key: "brakeBias",
      label: "Front brake bias",
      min: 40,
      max: 80,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "engineBraking",
      label: "Engine braking",
      min: 0,
      max: 50,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "dragArea",
      label: "Drag area",
      min: 0.3,
      max: 1.3,
      step: 0.01,
      scale: 1,
      unit: "m²",
    },
    {
      key: "downforceArea",
      label: "Downforce area",
      min: 0,
      max: 6,
      step: 0.1,
      scale: 1,
      unit: "m²",
    },
  ],
  tyres: [
    {
      key: "grip",
      label: "Tyre friction",
      min: 0.5,
      max: 2.1,
      step: 0.01,
      scale: 1,
      unit: "μ",
    },
    {
      key: "longitudinalPeak",
      label: "Peak longitudinal slip",
      min: 6,
      max: 25,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "lateralPeak",
      label: "Peak slip angle",
      min: 4.1,
      max: 14,
      step: 0.1,
      scale: Math.PI / 180,
      unit: "°",
    },
    {
      key: "slideGrip",
      label: "Grip beyond the peak",
      min: 55,
      max: 100,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "loadSensitivity",
      label: "Load sensitivity",
      min: 0,
      max: 25,
      step: 1,
      scale: 0.01,
      unit: "%",
    },
  ],
  assists: [
    {
      key: "tractionControl",
      label: "Traction control",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "abs",
      label: "Anti-lock brakes",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "stabilityAssist",
      label: "Yaw stability",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "countersteerAssist",
      label: "Countersteer assist",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "speedSteering",
      label: "Speed-sensitive steering",
      min: 0,
      max: 100,
      step: 5,
      scale: 0.01,
      unit: "%",
    },
    {
      key: "steeringLimit",
      label: "Maximum steering angle",
      min: 15,
      max: 37,
      step: 0.1,
      scale: Math.PI / 180,
      unit: "°",
    },
    {
      key: "autoHold",
      label: "Stationary brake hold",
      min: 0,
      max: 100,
      step: 100,
      scale: 0.01,
      unit: "%",
    },
  ],
  suspension: [
    {
      key: "frontSpring",
      label: "Front spring rate",
      min: 12,
      max: 180,
      step: 0.5,
      scale: 1000,
      unit: "kN/m",
    },
    {
      key: "rearSpring",
      label: "Rear spring rate",
      min: 12,
      max: 180,
      step: 0.5,
      scale: 1000,
      unit: "kN/m",
    },
    {
      key: "frontDamping",
      label: "Front damping",
      min: 1.2,
      max: 10,
      step: 0.1,
      scale: 1000,
      unit: "kNs/m",
    },
    {
      key: "rearDamping",
      label: "Rear damping",
      min: 1.2,
      max: 10,
      step: 0.1,
      scale: 1000,
      unit: "kNs/m",
    },
    {
      key: "frontAntiRoll",
      label: "Front anti-roll",
      min: 0,
      max: 30,
      step: 0.5,
      scale: 1000,
      unit: "kN/m",
    },
    {
      key: "rearAntiRoll",
      label: "Rear anti-roll",
      min: 0,
      max: 30,
      step: 0.5,
      scale: 1000,
      unit: "kN/m",
    },
    {
      key: "restLength",
      label: "Spring free length",
      min: 180,
      max: 580,
      step: 5,
      scale: 0.001,
      unit: "mm",
      hint: "Longer springs raise the settled chassis.",
    },
    {
      key: "travel",
      label: "Compression travel",
      min: 100,
      max: 360,
      step: 5,
      scale: 0.001,
      unit: "mm",
      hint: "Progressive bump stops engage near the end of travel.",
    },
  ],
  chassis: [
    {
      key: "mass",
      label: "Vehicle mass",
      min: 450,
      max: 2600,
      step: 1,
      scale: 1,
      unit: "kg",
    },
    {
      key: "wheelbase",
      label: "Wheelbase",
      min: 2.05,
      max: 3.45,
      step: 0.01,
      scale: 1,
      unit: "m",
    },
    {
      key: "trackWidth",
      label: "Track width",
      min: 1.3,
      max: 2.1,
      step: 0.01,
      scale: 1,
      unit: "m",
    },
    {
      key: "frontWeight",
      label: "Front weight distribution",
      min: 30,
      max: 68,
      step: 0.1,
      scale: 0.01,
      unit: "%",
    },
  ],
};

function renderField(
  field: Field,
  setup: VehicleSetup,
  baseline: VehicleSetup,
) {
  const precision = (String(field.step).split(".")[1] ?? "").length;
  const value = Number((setup[field.key] / field.scale).toFixed(precision));
  const percent = ((value - field.min) / (field.max - field.min)) * 100;
  return `<div class="setting-row ${Math.abs(setup[field.key] - baseline[field.key]) > 1e-6 ? "changed" : ""}"><div class="setting-title"><label for="range-${field.key}">${field.label}</label><button class="field-reset" data-action="reset-field:${field.key}" aria-label="Reset ${field.label}" title="Reset to ${Number((baseline[field.key] / field.scale).toFixed(2))} ${field.unit}">↺</button><span class="value-input"><input id="number-${field.key}" type="number" data-setting="${field.key}" aria-label="${field.label} value" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}"/><span>${field.unit}</span></span></div><input id="range-${field.key}" aria-label="${field.label}" type="range" data-setting="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}" style="--fill:${percent}%"/>${field.hint ? `<p class="setting-hint">${field.hint}</p>` : ""}</div>`;
}

export class Workbench {
  readonly viewport: HTMLElement;
  readonly generator: CircuitGeneratorPanel;
  readonly cars: CarWorkshopPanel;
  readonly garage: GaragePanel;
  readonly trace: TracePanel;
  readonly inputSettings: InputPanel;
  private circuit = getTestCircuit();
  private map = mapProjection(this.circuit, 220, 150);
  private setup: VehicleSetup;
  private draft: VehicleSetup;
  private diagrams: Diagrams;
  private tab = "suspension";
  private worldDatum = false;
  private advanced = false;
  private linked = false;
  private savedReference?: VehicleSetup;
  private baseline: VehicleSetup;
  private toastTimeout = 0;
  private readonly abort = new AbortController();
  private cache = new Map<string, HTMLElement>();
  constructor(
    private root: HTMLElement,
    setup: VehicleSetup,
    private callbacks: WorkbenchCallbacks,
    hasSaved: boolean,
  ) {
    this.setup = { ...setup };
    this.draft = { ...setup };
    this.baseline = this.factorySetup(setup);
    if (hasSaved) this.savedReference = copySetup(setup);
    const circuit = this.circuit;
    const route = routePath(circuit, 220, 150);
    const elevation = elevationPath(circuit, 220, 35);
    root.innerHTML = `
      <header class="app-header">
        <a class="brand" href="#" aria-label="Procgen Racing home" data-action="home"><span class="brand-mark">P<span>R</span></span><span>PROCGEN<span class="brand-light">RACING</span></span></a>
        <div class="header-divider"></div><span class="header-title">DYNAMICS LAB <span>/ 06</span></span>
        <div class="header-right"><button class="button subtle header-workshop" data-action="car-workshop">Car workshop</button><button class="button subtle header-workshop" data-action="garage">Garage / Compare</button><span class="live-badge" id="live-badge"><i></i>LIVE SIMULATION</span><button class="button subtle" id="pause-button" data-action="pause">${icon("pause")}<span>Pause</span></button><button class="button subtle surface-sound-button" id="surface-sound-button" data-action="surface-sound" aria-pressed="false">Surface sound off</button><button class="button save-button" data-action="save">${icon("save")}Save setup</button></div>
      </header>
      <div class="workspace">
        <nav class="tool-rail" aria-label="Workbench tools"><div class="rail-tools"><button class="rail-button" data-action="car-workshop" title="Car workshop" aria-label="Open car workshop">${icon("rig")}</button><button class="rail-button" data-action="garage" title="Garage and A/B comparison" aria-label="Open garage and comparison">${icon("compare")}</button><button class="rail-button active" data-action="home" title="Suspension rig" aria-label="Suspension rig">${icon("rig")}</button><button class="rail-button" data-action="generator" title="Circuit workshop" aria-label="Open circuit workshop">${icon("layers")}</button><button class="rail-button" data-action="inspector" title="Toggle setup panel" aria-label="Toggle setup panel">${icon("sliders")}</button><button class="rail-button" data-action="telemetry" title="Expand response trace" aria-label="Expand response trace">${icon("chart")}</button></div><button class="rail-button" data-action="input-settings" title="Input settings" aria-label="Open input settings">${icon("sliders")}</button><button class="rail-button" data-action="help" title="Controls and guide" aria-label="Controls and guide">${icon("help")}</button><span class="rail-version">M6</span></nav>
        <main class="lab-main">
          <div class="scene-toolbar"><div class="experiment-selector" role="group" aria-label="Test surface"><button data-experiment="circuit" data-action="experiment:circuit">3D circuit</button><button class="selected" data-experiment="level" data-action="experiment:level">Level pad</button><button data-experiment="bump" data-action="experiment:bump">Single-wheel bump</button><button data-experiment="pitch" data-action="experiment:pitch">Incline</button><button data-experiment="bank" data-action="experiment:bank">Bank</button><button data-experiment="handling" data-action="experiment:handling">Drive pad</button><button data-experiment="split" data-action="experiment:split">Split grip</button></div><div class="toolbar-actions"><button class="button toolbar-test" data-action="drop">${icon("drop")}Drop test</button><button class="icon-button" data-action="reset" title="Reset vehicle (R)" aria-label="Reset vehicle">${icon("reset")}</button></div></div>
          <div class="circuit-controls" id="circuit-controls" hidden><div><span class="eyebrow" id="circuit-name">RIDGE / PROVING CIRCUIT</span><label for="circuit-start-select">Test start</label><select id="circuit-start-select">${circuit.definition.starts.map((start) => `<option value="${start.id}">${start.name}</option>`).join("")}</select><button class="button subtle" data-action="camera:overview">Circuit overview</button><button class="button generator-open" data-action="generator">Circuit workshop ↗</button></div><p id="circuit-start-description">${circuit.definition.starts[0].description}</p></div>
          <section class="scene-stage" aria-label="Suspension test scene">
            <div class="scene-heading"><div class="eyebrow">VEHICLE DEVELOPMENT / TEST FACILITY</div><h1>Suspension lab<span class="heading-dot">.</span></h1><p id="experiment-description">Four contact patches. One connected chassis.</p></div>
            <div id="viewport"></div>
            <div class="scene-top-right"><span class="scene-chip"><i></i><span id="scene-status">4 WHEELS GROUNDED</span></span></div>
            <div class="scene-view-controls"><button class="view-button selected" data-camera="orbit" data-action="camera:orbit">Orbit</button><button class="view-button" data-camera="chase" data-action="camera:chase">Chase</button><button class="view-button" data-camera="top" data-action="camera:top">Top</button><span></span><button class="view-button" id="forces-button" data-action="forces" aria-pressed="false">${icon("layers")}Forces</button></div>
            <div class="scene-corner-label"><span>03</span><span id="reference-name">FR / COUPE</span> <b id="vehicle-label">RWD · 1,250 KG</b></div>
            <div class="powertrain-hud"><div class="gear-selector" role="group" aria-label="Driving direction"><button data-action="gear:reverse" data-direction="reverse">R</button><button data-action="gear:neutral" data-direction="neutral">N</button><button data-action="gear:drive" data-direction="drive" class="selected">D</button></div><strong id="gear-value">1</strong><span id="rpm-value">1,000 RPM</span><div class="rpm-track"><i id="rpm-fill"></i></div><small>V REVERSE · Q / E SHIFT</small></div><div class="assist-badges"><span id="tc-status">TC</span><span id="abs-status">ABS</span><span id="esc-status">ESC</span><span id="hold-status">HOLD</span></div><div class="drive-readout"><strong id="speed-value">0</strong><span>KM/H</span><div><i id="throttle-meter"></i><i id="brake-meter"></i></div></div>
            <div class="circuit-map" id="circuit-map" hidden><header><strong id="circuit-section">01 / Start straight</strong><span id="circuit-distance">0 / ${Math.round(circuit.distance)} m</span></header><svg viewBox="0 0 220 150" role="img" aria-label="Circuit map and vehicle position"><path id="circuit-route-edge" class="map-route-edge" d="${route}"/><path id="circuit-route" class="map-route" d="${route}"/><path id="circuit-car-heading" d="M10 0 L-4 -5 L-1 0 L-4 5Z"/><circle id="circuit-car-dot" r="4" cx="60" cy="105"/></svg><p id="circuit-advisory" class="circuit-advisory" hidden></p><svg class="elevation-profile" viewBox="0 0 220 35" role="img" aria-label="Circuit elevation profile"><path id="circuit-elevation-path" d="${elevation}"/><line id="elevation-cursor" x1="0" y1="0" x2="0" y2="35"/></svg><div class="circuit-metrics"><span>GRADE <b id="circuit-grade">0%</b></span><span>BANK <b id="circuit-bank">0°</b></span><span>WIDTH <b id="circuit-width">15 m</b></span><span>HEIGHT <b id="circuit-altitude">1.2 m</b></span></div></div>
            <div class="viewport-error" id="viewport-error" hidden></div>
          </section>
          <section class="instruments" aria-label="Live vehicle dynamics"><div class="instruments-heading"><span class="eyebrow">LIVE CHASSIS TELEMETRY</span><button id="datum-button" class="datum-button" data-action="datum" title="Switch between road-relative and world-relative body angles">ROAD RELATIVE ${icon("arrow")}</button></div><div class="diagram-grid-layout">${diagramMarkup}</div></section>
          <section class="response-panel" id="response-panel" hidden></section>
        </main>
        <aside class="inspector" aria-label="Vehicle tuning workbench">
          <div class="inspector-heading"><span class="eyebrow">SETUP WORKBENCH</span><div><h2>Make it yours.</h2><button class="icon-button" data-action="undo" id="undo-button" title="Undo setup change" aria-label="Undo setup change" disabled>${icon("undo")}</button><button class="icon-button" data-action="redo" id="redo-button" title="Redo setup change" aria-label="Redo setup change" disabled>↪</button></div><p>Adjust. Test. Understand the response.</p></div>
          <div class="reference-car"><label for="reference-car-select">REFERENCE VEHICLE</label><select id="reference-car-select" aria-label="Reference vehicle"><option value="generated" disabled>Generated car</option>${Object.entries(
            REFERENCE_CARS,
          )
            .map(
              ([id, car]) =>
                `<option value="${id}" ${id === this.setup.referenceCar ? "selected" : ""}>${car.name}</option>`,
            )
            .join(
              "",
            )}</select><p id="reference-car-description">${REFERENCE_CARS[this.setup.referenceCar].description}</p></div><div class="preset-row"><label for="preset-select">BASE SETUP</label><select id="preset-select" aria-label="Base setup"><option value="balanced">Balanced road car</option><option value="comfort">Comfort / soft</option><option value="track">Track / firm</option><option value="custom" disabled>Custom setup</option></select><span class="preset-status" id="preset-status">BASELINE</span></div>
          <div class="setup-tabs" role="tablist" aria-label="Tuning category"><button role="tab" aria-selected="true" id="tab-suspension" aria-controls="settings-panel" data-tab="suspension">Suspension</button><button role="tab" aria-selected="false" id="tab-chassis" aria-controls="settings-panel" data-tab="chassis">Chassis</button><button role="tab" aria-selected="false" id="tab-powertrain" aria-controls="settings-panel" data-tab="powertrain">Drivetrain</button><button role="tab" aria-selected="false" id="tab-tyres" aria-controls="settings-panel" data-tab="tyres">Tyres</button><button role="tab" aria-selected="false" id="tab-assists" aria-controls="settings-panel" data-tab="assists">Assists</button></div>
          <div class="setup-mode"><label><input type="checkbox" id="advanced-mode"/>All settings</label><label><input type="checkbox" id="link-axles"/>Link axle edits</label></div><div class="inspector-scroll"><div id="settings-panel" role="tabpanel" aria-labelledby="tab-suspension"></div>
            <div class="derived-values"><span>RIDE FREQUENCY</span><div><strong id="front-frequency">1.62 <small>Hz</small></strong><span>FRONT</span><strong id="rear-frequency">1.68 <small>Hz</small></strong><span>REAR</span></div></div>
            <p class="setup-derived-extra" id="setup-derived-extra"></p><div class="test-controls"><div class="section-label"><span>EXCITE THE CHASSIS</span><span>TESTS</span></div><button class="button drop-button" data-action="drop">${icon("drop")}Run drop test<span>+0.6 m</span></button><div class="pulse-buttons"><button class="button subtle" data-action="roll-pulse">Roll pulse</button><button class="button subtle" data-action="pitch-pulse">Pitch pulse</button></div></div>
            <div class="weight-block"><div class="section-label"><span>LIVE AXLE LOAD</span><span id="axle-total">12.3 kN</span></div><div class="weight-values"><span>FRONT <strong id="front-weight">54%</strong></span><span>REAR <strong id="rear-weight">46%</strong></span></div><div class="weight-bar"><i id="weight-bar-fill" style="width:54%"></i></div></div>
            <div class="setup-note"><span class="note-dot"></span><p>Use Test start to compare hills, banking, kerbs and loose surfaces. The Tyres tab shows each contact’s surface and slip.</p></div>
          </div>
          <div class="inspector-footer"><button class="button subtle" data-action="compare" id="compare-button" ${hasSaved ? "" : "disabled"}>${icon("compare")}Compare saved</button><button class="button subtle" data-action="defaults" title="Restore this reference vehicle’s baseline">Reset setup</button></div>
        </aside>
      </div>
      <footer class="status-bar"><span class="status-health"><i></i><span id="simulation-status">120 HZ PHYSICS</span></span><span id="performance-status">60 FPS</span><span class="status-controls"><kbd>W A S D</kbd> Drive <kbd>R</kbd> Reset <kbd>SPACE</kbd> Pause <button data-action="help">All controls ${icon("arrow")}</button></span><span id="input-status">KEYBOARD / GAMEPAD READY</span></footer>
      <div class="toast" id="toast" role="status" hidden></div>
      <dialog id="help-dialog"><div class="dialog-top"><span class="eyebrow">DYNAMICS LAB / QUICK START</span><button class="icon-button" data-action="close-help" aria-label="Close guide">×</button></div><h2>Feel what the wheels feel.</h2><p>Four wheels share the work. Choose a reference car, try a repeatable test, then tune suspension, tyres, drivetrain and assists.</p><div class="help-steps"><div><b>01</b><span><strong>Choose a surface</strong>Choose the 3D circuit and a Test start, or use the original pads for isolated suspension tests.</span></div><div><b>02</b><span><strong>Change the response</strong>Spring rate supports the body. Damping controls how quickly it settles. Anti-roll links the two sides.</span></div><div><b>03</b><span><strong>Read the diagrams</strong>Roll and pitch default to the local road reference. Switch to World to include the road's slope.</span></div></div><dl class="controls-list"><dt>W / ↑</dt><dd>Throttle · gamepad right trigger</dd><dt>S / ↓</dt><dd>Brake · gamepad left trigger</dd><dt>A D / ← →</dt><dd>Steer · gamepad left stick</dd><dt>R / Space / C</dt><dd>Reset / Pause / Cycle camera</dd><dt>Mouse drag / scroll</dt><dd>Orbit / Zoom</dd></dl><p class="help-scope">W / right trigger accelerates in the selected direction. S / left trigger brakes. Stop, then select R or press V to reverse. Q/E shift gears, Shift or gamepad A applies the rear handbrake. Gamepad D-pad up/down selects D/R; shoulder buttons shift. Tyres share grip between acceleration, braking and cornering.</p><button class="button save-button" data-action="close-help">Back to the lab ${icon("arrow")}</button></dialog>`;
    this.viewport = this.node("viewport");
    this.diagrams = new Diagrams(root);
    this.renderSettings();
    this.updateSummary();
    this.generator = new CircuitGeneratorPanel(root, {
      generate: callbacks.generate,
      action: callbacks.action,
    });
    this.cars = new CarWorkshopPanel(root, (next, rebuild) => {
      this.callbacks.setup(next, rebuild);
      this.setSetup(next);
    });
    this.garage = new GaragePanel(root, hasSaved ? setup : null, (next) => {
      this.callbacks.setup(next, true);
      this.setSetup(next);
    });
    this.trace = new TracePanel(this.node("response-panel"), setup);
    this.inputSettings = new InputPanel(root, (settings) => {
      callbacks.input(settings);
      this.updateInputLabels(settings);
    });
    this.updateInputLabels(loadInputSettings());
    const options = { signal: this.abort.signal };
    root.addEventListener("click", this.onClick, options);
    root.addEventListener("input", this.onInput, options);
    root.addEventListener("change", this.onChange, options);
  }

  node(id: string) {
    let element = this.cache.get(id);
    if (!element) {
      element = this.root.querySelector<HTMLElement>(`#${id}`)!;
      this.cache.set(id, element);
    }
    return element;
  }

  private onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-action], [data-tab]",
    );
    if (!button) return;
    if (button.dataset.tab) {
      this.tab = button.dataset.tab;
      this.renderSettings();
      this.root
        .querySelectorAll<HTMLElement>("[data-tab]")
        .forEach((el) =>
          el.setAttribute("aria-selected", String(el.dataset.tab === this.tab)),
        );
      this.node("settings-panel").setAttribute(
        "aria-labelledby",
        `tab-${this.tab}`,
      );
      return;
    }
    const action = button.dataset.action!;
    if (action === "car-workshop" || action === "garage") {
      if (this.hasPendingChanges) {
        this.toast("Apply or discard the pending chassis changes first.");
        return;
      }
      if (action === "car-workshop") this.cars.open(this.setup);
      else this.garage.open(this.setup);
      return;
    }
    if (action === "input-settings") {
      this.inputSettings.open();
      return;
    }
    if (action === "discard-chassis") {
      this.draft = copySetup(this.setup);
      this.renderSettings();
      this.markCustom();
      return;
    }
    if (action.startsWith("reset-field:")) {
      const key = action.slice(12) as NumericSetupKey,
        base = this.comparisonBase();
      this.draft = sanitizeSetup({ ...this.draft, [key]: base[key] });
      if (!STRUCTURAL_KEYS.has(key)) {
        this.setup = sanitizeSetup({ ...this.setup, [key]: base[key] });
        this.callbacks.setup(this.setup, false, key);
      }
      this.renderSettings();
      this.markCustom();
      this.updateSummary();
      return;
    }
    if (action === "home") event.preventDefault();
    if (action === "datum") {
      this.worldDatum = !this.worldDatum;
      this.node("datum-button").innerHTML =
        `${this.worldDatum ? "WORLD" : "ROAD"} RELATIVE ${icon("arrow")}`;
      return;
    }
    if (action === "telemetry") {
      this.node("response-panel").hidden = !this.node("response-panel").hidden;
      if (!this.node("response-panel").hidden) this.trace.refreshRecordings();
      return;
    }
    if (action === "inspector") {
      this.root.classList.toggle("inspector-collapsed");
      return;
    }
    if (action === "help") {
      (this.node("help-dialog") as HTMLDialogElement).showModal();
      return;
    }
    if (action === "close-help") {
      (this.node("help-dialog") as HTMLDialogElement).close();
      return;
    }
    if (action === "generator") {
      this.generator.open();
      return;
    }
    if (action === "apply-chassis") {
      this.setup = { ...this.draft };
      this.callbacks.setup(this.setup, true);
      this.renderSettings();
      this.updateSummary();
      this.markCustom();
      return;
    }
    this.callbacks.action(action);
  };

  private onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.corner) {
      if (!Number.isFinite(input.valueAsNumber)) return;
      const [id, property] = input.dataset.corner.split(":") as [
        "fl" | "fr" | "rl" | "rr",
        "springScale" | "dampingScale" | "rideOffset",
      ];
      const corner = {
        springScale: 1,
        dampingScale: 1,
        rideOffset: 0,
        ...this.setup.corners?.[id],
        [property]:
          input.valueAsNumber * (property === "rideOffset" ? 0.001 : 0.01),
      };
      this.setup = sanitizeSetup({
        ...this.setup,
        corners: { ...this.setup.corners, [id]: corner },
      });
      this.draft = sanitizeSetup({
        ...this.draft,
        corners: this.setup.corners,
      });
      this.callbacks.setup(this.setup, false, input.dataset.corner);
      this.markCustom();
      return;
    }
    const key = input.dataset.setting as NumericSetupKey | undefined;
    if (!key) return;
    if (!input.value || !Number.isFinite(input.valueAsNumber)) return;
    const field = fields[this.tab].find((f) => f.key === key)!;
    const candidate = sanitizeSetup({
      ...this.draft,
      [key]: input.valueAsNumber * field.scale,
    });
    this.draft = candidate;
    const paired: Partial<Record<NumericSetupKey, NumericSetupKey>> = {
      frontSpring: "rearSpring",
      rearSpring: "frontSpring",
      frontDamping: "rearDamping",
      rearDamping: "frontDamping",
      frontAntiRoll: "rearAntiRoll",
      rearAntiRoll: "frontAntiRoll",
    };
    const pair = this.linked ? paired[key] : undefined;
    if (pair) {
      this.draft = sanitizeSetup({
        ...candidate,
        [pair]:
          this.setup[key] > 0
            ? (this.setup[pair] * candidate[key]) / this.setup[key]
            : this.setup[pair] + candidate[key] - this.setup[key],
      });
    }
    const value = Number((candidate[key] / field.scale).toFixed(3));
    this.root
      .querySelectorAll<HTMLInputElement>(`[data-setting="${key}"]`)
      .forEach((el) => {
        if (el !== input) el.value = String(value);
        el.style.setProperty(
          "--fill",
          `${((value - field.min) / (field.max - field.min)) * 100}%`,
        );
      });
    if (STRUCTURAL_KEYS.has(key)) {
      this.node("apply-chassis-bar").hidden = false;
      this.markCustom();
      return;
    }
    this.setup = sanitizeSetup({
      ...this.setup,
      [key]: this.draft[key],
      ...(pair ? { [pair]: this.draft[pair] } : {}),
    });
    if (pair)
      this.root
        .querySelectorAll<HTMLInputElement>(`[data-setting="${pair}"]`)
        .forEach((el) => (el.value = String(this.setup[pair] / field.scale)));
    this.callbacks.setup(this.setup, false, key);
    this.updateChangedFields();
    this.markCustom();
    this.updateSummary();
  };

  private onChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "advanced-mode") {
      this.advanced = input.checked;
      this.renderSettings();
      return;
    }
    if (input.id === "link-axles") {
      this.linked = input.checked;
      return;
    }
    if (input.id === "corner-overrides") {
      this.setup = sanitizeSetup({
        ...this.setup,
        corners: input.checked
          ? {
              fl: { springScale: 1, dampingScale: 1, rideOffset: 0 },
              fr: { springScale: 1, dampingScale: 1, rideOffset: 0 },
              rl: { springScale: 1, dampingScale: 1, rideOffset: 0 },
              rr: { springScale: 1, dampingScale: 1, rideOffset: 0 },
            }
          : undefined,
      });
      this.draft = { ...this.draft, corners: this.setup.corners };
      this.callbacks.setup(this.setup, false);
      this.renderSettings();
      return;
    }
    if (input.id === "circuit-start-select") {
      this.callbacks.action(`circuit-start:${input.value}`);
      input.blur();
    }
    if (input.id === "preset-select")
      this.callbacks.action(`preset:${input.value}`);
    if (input.id === "reference-car-select")
      this.callbacks.action(`car:${input.value}`);
    const enumKey = input.dataset.enum;
    if (enumKey) {
      this.setup = sanitizeSetup({ ...this.setup, [enumKey]: input.value });
      this.draft = sanitizeSetup({ ...this.draft, [enumKey]: input.value });
      this.callbacks.setup(this.setup, false);
      this.markCustom();
      this.renderSettings();
      this.updateSummary();
    }
    if (input.id === "drive-select") {
      const pending = this.draft;
      this.setup = sanitizeSetup({ ...this.setup, drive: input.value });
      this.draft = sanitizeSetup({ ...pending, drive: input.value });
      this.callbacks.setup(this.setup, false);
      this.markCustom();
      this.updateSummary();
    }
    if (input.dataset.setting) {
      const field = fields[this.tab].find(
        (f) => f.key === input.dataset.setting,
      )!;
      const target = STRUCTURAL_KEYS.has(field.key) ? this.draft : this.setup;
      input.value = String(
        Number((target[field.key] / field.scale).toFixed(3)),
      );
    }
  };

  private renderSettings() {
    // These descendants are replaced on tab/setup changes, so evict only their cached nodes.
    this.cache.delete("apply-chassis-bar");
    this.node("settings-panel").innerHTML =
      `<div class="section-label"><span>${{ suspension: "SPRINGS & DAMPERS", chassis: "DIMENSIONS & BALANCE", powertrain: "ENGINE, GEARS & BRAKES", tyres: "CONTACT & COMBINED SLIP", assists: "BOUNDED DRIVING ASSISTS" }[this.tab]}</span><span>${this.tab === "chassis" ? "REBUILD" : "LIVE"}</span></div>${this.extraControls()}${fields[
        this.tab
      ]
        .filter(
          (f) =>
            (f.key !== "awdFrontSplit" || this.setup.drive === "awd") &&
            (this.advanced ||
              ![
                "diffLock",
                "engineBraking",
                "loadSensitivity",
                "longitudinalPeak",
                "lateralPeak",
                "slideGrip",
                "dragArea",
                "downforceArea",
                "countersteerAssist",
                "speedSteering",
                "autoHold",
              ].includes(f.key)),
        )
        .map((f) =>
          renderField(
            f,
            STRUCTURAL_KEYS.has(f.key) ? this.draft : this.setup,
            this.comparisonBase(),
          ),
        )
        .join(
          "",
        )}${this.tab === "chassis" ? `<div class="apply-chassis" id="apply-chassis-bar" ${this.hasPendingChanges ? "" : "hidden"}><p>Apply dimensions to rebuild and reset the rig.</p><button class="button save-button" data-action="apply-chassis">Apply chassis changes</button><button class="button subtle" data-action="discard-chassis">Discard changes</button></div><div class="select-setting"><label for="drive-select">Driven wheels</label><select id="drive-select"><option value="rwd" ${this.setup.drive === "rwd" ? "selected" : ""}>Rear-wheel drive</option><option value="fwd" ${this.setup.drive === "fwd" ? "selected" : ""}>Front-wheel drive</option><option value="awd" ${this.setup.drive === "awd" ? "selected" : ""}>All-wheel drive</option></select></div><p class="setting-hint">Mass distribution changes the physical centre of mass. Dimensions update both wheel contacts and body geometry.</p>` : ""}`;
  }

  private extraControls() {
    if (this.tab === "suspension" && this.advanced)
      return `<details class="corner-overrides"><summary>Per-wheel overrides</summary><label><input type="checkbox" id="corner-overrides" ${this.setup.corners ? "checked" : ""}/>Enable independent corner tuning</label>${
        this.setup.corners
          ? `<p>Multipliers apply to the axle values below. Ride offsets alter each spring’s free length.</p><div class="corner-tuning-grid">${(
              ["fl", "fr", "rl", "rr"] as const
            )
              .map((id) => {
                const c = this.setup.corners?.[id] ?? {
                  springScale: 1,
                  dampingScale: 1,
                  rideOffset: 0,
                };
                return `<fieldset><legend>${id.toUpperCase()}</legend><label>Spring %<input type="number" aria-label="${id.toUpperCase()} spring multiplier" data-corner="${id}:springScale" min="65" max="140" value="${Math.round(c.springScale * 100)}"/></label><label>Damping %<input type="number" aria-label="${id.toUpperCase()} damping multiplier" data-corner="${id}:dampingScale" min="65" max="140" value="${Math.round(c.dampingScale * 100)}"/></label><label>Ride mm<input type="number" aria-label="${id.toUpperCase()} ride offset" data-corner="${id}:rideOffset" min="-30" max="30" value="${Math.round(c.rideOffset * 1000)}"/></label></fieldset>`;
              })
              .join("")}</div>`
          : ""
      }</details>`;
    const select = (
      key: keyof VehicleSetup,
      label: string,
      options: string[],
    ) =>
      '<div class="select-setting"><label for="enum-' +
      key +
      '">' +
      label +
      '</label><select id="enum-' +
      key +
      '" data-enum="' +
      key +
      '">' +
      options
        .map(
          (value) =>
            '<option value="' +
            value +
            '" ' +
            (this.setup[key] === value ? "selected" : "") +
            ">" +
            value.toUpperCase() +
            "</option>",
        )
        .join("") +
      "</select></div>";
    if (this.tab === "powertrain")
      return (
        select("transmission", "Transmission", ["automatic", "manual"]) +
        select("gearing", "Gear spacing", ["road", "close", "long"]) +
        '<div class="gear-ratios">' +
        GEAR_SETS[this.setup.gearing]
          .map(
            (r, i) => "<span>" + (i + 1) + "<b>" + r.toFixed(2) + "</b></span>",
          )
          .join("") +
        "</div>" +
        select("frontDiff", "Front differential", ["open", "lsd", "locked"]) +
        select("rearDiff", "Rear differential", ["open", "lsd", "locked"]) +
        (this.setup.drive === "awd"
          ? select("centreDiff", "Centre coupling", ["open", "lsd", "locked"])
          : "")
      );
    if (this.tab === "tyres")
      return (
        '<div class="live-tyre-table" id="live-tyre-table"><div><b>WHEEL</b><b>SLIP</b><b>ANGLE</b><b>RPM</b><b>SURFACE</b></div>' +
        ["fl", "fr", "rl", "rr"]
          .map(
            (id) =>
              '<div data-wheel-row="' +
              id +
              '"><b>' +
              id.toUpperCase() +
              "</b><span>0%</span><span>0°</span><span>0</span><span>ASPHALT</span></div>",
          )
          .join("") +
        '</div><div class="surface-legend">' +
        Object.entries(SURFACES)
          .map(
            ([id, surface]) =>
              '<span title="Grip multiplier ' +
              surface.grip +
              '"><i style="background:#' +
              surface.color.toString(16).padStart(6, "0") +
              '"></i>' +
              id.toUpperCase() +
              "</span>",
          )
          .join("") +
        '</div><p class="setting-hint">Forward: +slip is wheelspin; −slip is braking. Signs reverse in R. Angle measures sideways travel; all forces share one grip budget.</p>'
      );
    if (this.tab === "assists")
      return '<div class="assist-presets"><button data-action="assists:accessible">Accessible</button><button data-action="assists:balanced">Balanced</button><button data-action="assists:direct">Direct</button><button data-action="assists:drift">Drift</button></div><p class="setting-hint">TC reduces engine torque. ABS modulates each brake. Stability applies bounded yaw torque; countersteer adds a limited steering correction. Airborne chassis receive no ground assists.</p>';
    return "";
  }

  setSetup(setup: VehicleSetup, preset?: string) {
    this.setup = { ...setup };
    this.draft = { ...setup };
    this.baseline = this.factorySetup(setup);
    this.trace?.setSetup(setup);
    this.renderSettings();
    this.updateSummary();
    const select = this.node("preset-select") as HTMLSelectElement;
    select.value = preset && PRESETS[preset] ? preset : "custom";
    this.node("preset-status").textContent = preset ? "BASELINE" : "MODIFIED";
  }
  private markCustom() {
    (this.node("preset-select") as HTMLSelectElement).value = "custom";
    this.node("preset-status").textContent = this.hasPendingChanges
      ? "PENDING CHASSIS"
      : "MODIFIED";
  }
  private factorySetup(setup: VehicleSetup) {
    try {
      return setup.vehicle
        ? generateCar(setup.vehicle.recipe).setup
        : REFERENCE_CARS[setup.referenceCar].setup;
    } catch {
      return copySetup(setup);
    }
  }
  private updateChangedFields() {
    const base = this.comparisonBase();
    this.root.querySelectorAll<HTMLElement>(".setting-row").forEach((row) => {
      const key = row.querySelector<HTMLInputElement>("[data-setting]")?.dataset
        .setting as NumericSetupKey | undefined;
      if (key)
        row.classList.toggle(
          "changed",
          Math.abs(this.setup[key] - base[key]) > 1e-6,
        );
    });
  }
  setSavedReference(setup: VehicleSetup) {
    this.savedReference = copySetup(setup);
    this.renderSettings();
  }
  private comparisonBase() {
    const id = (s: VehicleSetup) =>
      s.vehicle
        ? fingerprint({
            family: s.vehicle.family,
            dimensions: s.vehicle.dimensions,
            components: s.vehicle.components,
          })
        : s.referenceCar;
    return this.savedReference && id(this.savedReference) === id(this.setup)
      ? this.savedReference
      : this.baseline;
  }
  recordTelemetry(t: VehicleTelemetry, yaw: number) {
    this.trace.capture(t, yaw);
  }
  private updateInputLabels(settings: InputSettings) {
    const key = (name: keyof InputSettings["keys"]) =>
      settings.keys[name][0]
        .replace(/^Key|^Digit/, "")
        .replace("ArrowUp", "↑")
        .replace("ArrowDown", "↓")
        .replace("ArrowLeft", "←")
        .replace("ArrowRight", "→");
    const hints = this.root.querySelectorAll(".status-controls kbd");
    if (hints[0])
      hints[0].textContent = [
        key("throttle"),
        key("left"),
        key("brake"),
        key("right"),
      ].join(" ");
    if (hints[1]) hints[1].textContent = key("reset");
    if (hints[2]) hints[2].textContent = key("pause");
    this.root.querySelector(".powertrain-hud small")!.textContent =
      `${key("reverse")} REVERSE · ${key("shiftDown")} / ${key("shiftUp")} SHIFT`;
  }
  private updateSummary() {
    this.trace?.setSetup(this.setup);
    (this.node("reference-car-select") as HTMLSelectElement).value = this.setup
      .vehicle
      ? "generated"
      : this.setup.referenceCar;
    this.node("reference-car-description").textContent =
      (this.setup.enginePosition === "mid"
        ? "Mid engine"
        : this.setup.enginePosition === "rear"
          ? "Rear engine"
          : "Front engine") +
      " · " +
      this.setup.drive.toUpperCase() +
      " · " +
      Math.round(this.setup.peakTorque) +
      " Nm";
    this.node("reference-car-description").title =
      "Approx. " +
      Math.round(
        (engineTorqueAtRpm(this.setup.redline * 0.8, this.setup) *
          this.setup.redline *
          0.8 *
          Math.PI) /
          30 /
          1000,
      ) +
      " kW near 80% redline";
    this.node("front-frequency").innerHTML =
      `${rideFrequency(this.setup, true).toFixed(2)} <small>Hz</small>`;
    this.node("rear-frequency").innerHTML =
      `${rideFrequency(this.setup, false).toFixed(2)} <small>Hz</small>`;
    this.node("reference-name").textContent = (
      this.setup.vehicle?.name ?? REFERENCE_CARS[this.setup.referenceCar].name
    ).toUpperCase();
    this.node("vehicle-label").textContent =
      `${this.setup.drive.toUpperCase()} · ${Math.round(this.setup.mass).toLocaleString()} KG`;
    const derived = carDerived(this.setup);
    this.node("setup-derived-extra").textContent =
      `${Math.round(derived.powerToWeight)} kW/t · ${Math.round(derived.clearance * 1000)} mm floor · ${(this.setup.frontWeight * 100).toFixed(1)}% front`;
  }
  setExperiment(experiment: string) {
    this.trace?.setCondition(
      `Manual / ${experiment}${experiment === "circuit" ? ` / ${this.circuit.definition.id}` : ""}`,
    );
    this.root
      .querySelectorAll<HTMLElement>("[data-experiment]")
      .forEach((el) =>
        el.classList.toggle("selected", el.dataset.experiment === experiment),
      );
    this.node("experiment-description").textContent =
      {
        level: "Four contact patches. One connected chassis.",
        bump: "Front-left wheel raised by 130 mm. Watch the load move.",
        pitch: "A seven-degree incline. Separate grade from body pitch.",
        bank: "A seven-degree bank. Watch road-relative body roll.",
        handling:
          "Open tarmac for launches, braking and steady-state cornering.",
        split:
          "Left wheels: low grip. Compare differentials, traction control and ABS.",
        circuit:
          "Elevation, banking, width changes and mixed grip. Follow the arrows.",
      }[experiment] ?? "";
    this.root.querySelector(".scene-heading h1")!.innerHTML =
      experiment === "circuit"
        ? `${this.circuit.definition.site.terrain ? "Procedural circuit" : "Surface proving ground"}<span class="heading-dot">.</span>`
        : experiment === "handling" || experiment === "split"
          ? 'Driving lab<span class="heading-dot">.</span>'
          : 'Suspension lab<span class="heading-dot">.</span>';
    this.node("circuit-controls").hidden = experiment !== "circuit";
    this.node("circuit-map").hidden = experiment !== "circuit";
  }
  setCircuitStart(id: string) {
    (this.node("circuit-start-select") as HTMLSelectElement).value = id;
    const start = this.circuit.definition.starts.find(
      (start) => start.id === id,
    )!;
    this.node("circuit-start-description").textContent = start.description;
    this.toast(start.description);
  }
  setCircuit(circuit: CompiledCircuit) {
    this.circuit = circuit;
    this.map = mapProjection(circuit, 220, 150);
    this.node("circuit-name").textContent = circuit.definition.name;
    const select = this.node("circuit-start-select") as HTMLSelectElement;
    select.replaceChildren(
      ...circuit.definition.starts.map((start) => {
        const option = document.createElement("option");
        option.value = start.id;
        option.textContent = start.name;
        return option;
      }),
    );
    this.node("circuit-start-description").textContent =
      circuit.definition.starts[0].description;
    this.node("circuit-route-edge").setAttribute(
      "d",
      routePath(circuit, 220, 150),
    );
    this.node("circuit-route").setAttribute("d", routePath(circuit, 220, 150));
    this.node("circuit-elevation-path").setAttribute(
      "d",
      elevationPath(circuit, 220, 35),
    );
    this.generator.setActive(circuit.definition.name);
    this.setExperiment("circuit");
  }
  setPaused(paused: boolean) {
    this.node("pause-button").innerHTML =
      `${icon(paused ? "play" : "pause")}<span>${paused ? "Resume" : "Pause"}</span>`;
    this.node("live-badge").innerHTML =
      `<i></i>${paused ? "SIMULATION PAUSED" : "LIVE SIMULATION"}`;
    this.node("live-badge").classList.toggle("paused", paused);
    this.node("simulation-status").textContent = paused
      ? "PAUSED"
      : "120 HZ PHYSICS";
  }
  setSound(enabled: boolean) {
    const button = this.node("surface-sound-button");
    button.textContent = enabled ? "Surface sound on" : "Surface sound off";
    button.setAttribute("aria-pressed", String(enabled));
  }
  setCamera(mode: string) {
    this.root
      .querySelectorAll<HTMLElement>("[data-camera]")
      .forEach((el) =>
        el.classList.toggle("selected", el.dataset.camera === mode),
      );
  }
  setForces(on: boolean) {
    this.node("forces-button").classList.toggle("selected", on);
    this.node("forces-button").setAttribute("aria-pressed", String(on));
  }
  update(
    t: VehicleTelemetry,
    fps: number,
    physicsMs: number,
    inputName: string | null,
  ) {
    this.diagrams.update(t, this.worldDatum, this.setup.drive);
    const gear = t.powertrain.gear;
    this.node("gear-value").textContent =
      gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
    this.node("rpm-value").textContent =
      Math.round(t.powertrain.rpm).toLocaleString() +
      " RPM" +
      (t.powertrain.shifting ? " · SHIFT" : "");
    this.node("rpm-fill").style.width =
      Math.min(100, (t.powertrain.rpm / this.setup.redline) * 100) + "%";
    this.root
      .querySelectorAll<HTMLElement>("[data-direction]")
      .forEach((el) =>
        el.classList.toggle(
          "selected",
          el.dataset.direction ===
            (gear < 0 ? "reverse" : gear === 0 ? "neutral" : "drive"),
        ),
      );
    for (const [id, value] of [
      ["tc-status", t.assists.traction],
      ["abs-status", t.assists.abs],
      ["esc-status", t.assists.stability],
      ["hold-status", t.assists.hold ? 1 : 0],
    ] as const)
      this.node(id).classList.toggle("intervening", value > 0.05);
    t.wheels.forEach((w) => {
      const row = this.root.querySelector<HTMLElement>(
        '[data-wheel-row="' + w.id + '"]',
      );
      if (!row) return;
      const values = row.querySelectorAll("span");
      values[0].textContent = (w.slipRatio * 100).toFixed(0) + "%";
      values[1].textContent = ((w.slipAngle * 180) / Math.PI).toFixed(1) + "°";
      values[2].textContent = Math.round(
        (w.angularSpeed * 60) / (2 * Math.PI),
      ).toString();
      values[3].textContent = w.grounded ? w.surface.toUpperCase() : "AIR";
      row.title = `${SURFACES[w.surface].name} · grip multiplier ${w.surfaceGrip.toFixed(2)} · load ${(w.load / 1000).toFixed(1)} kN`;
      if (w.surfaceBlend && w.surfaceBlend.length > 1)
        row.title += ` · footprint ${w.surfaceBlend.map((s) => `${s.surface} ${Math.round(s.weight * 100)}%`).join(" / ")}`;
    });
    if (t.track) {
      this.node("circuit-section").textContent = t.track.section;
      this.node("circuit-distance").textContent =
        `${Math.round(t.track.distance)} / ${Math.round(t.track.lapDistance)} m`;
      this.node("circuit-grade").textContent =
        `${t.track.grade >= 0 ? "+" : ""}${(t.track.grade * 100).toFixed(1)}%`;
      this.node("circuit-bank").textContent =
        `${((t.track.bank * 180) / Math.PI).toFixed(1)}°`;
      this.node("circuit-width").textContent = `${t.track.width.toFixed(1)} m`;
      this.node("circuit-altitude").textContent =
        `${this.circuit.alignment.sample(t.track.station).position.y.toFixed(1)} m`;
      this.node("circuit-car-dot").setAttribute(
        "cx",
        String(this.map.point(t.position.x, t.position.z).x),
      );
      this.node("circuit-car-dot").setAttribute(
        "cy",
        String(this.map.point(t.position.x, t.position.z).y),
      );
      const p = this.map.point(t.position.x, t.position.z),
        q = t.rotation;
      const forward = this.map.direction(
        2 * (q.x * q.z + q.w * q.y),
        1 - 2 * (q.x * q.x + q.y * q.y),
      );
      this.node("circuit-car-heading").setAttribute(
        "transform",
        `translate(${p.x} ${p.y}) rotate(${(Math.atan2(forward.y, forward.x) * 180) / Math.PI})`,
      );
      const venue = this.circuit.definition.venue,
        pit = venue?.pit,
        advisory = this.node("circuit-advisory");
      advisory.hidden = true;
      if (pit) {
        const s =
          ((t.track.station + this.circuit.length / 2) % this.circuit.length) -
          this.circuit.length / 2;
        if (
          s >= pit.entry &&
          s <= pit.exit &&
          Math.abs(
            t.track.lateral -
              pit.side * pitOffset(pit, t.track.station, this.circuit.length),
          ) <
            pit.width / 2 + 1
        ) {
          advisory.textContent = "PIT LANE · 50 KM/H";
          advisory.hidden = false;
        }
      }
      if (advisory.hidden && venue) {
        const fan = venue.fans.find((f) => {
          const d =
            ((((t.track!.station -
              f.at * this.circuit.length +
              this.circuit.length / 2) %
              this.circuit.length) +
              this.circuit.length) %
              this.circuit.length) -
            this.circuit.length / 2;
          return d >= -90 && d <= 20;
        });
        if (fan) {
          advisory.textContent = `CORNER GUIDE · ${Math.round(fan.designSpeed * 3.6)} KM/H`;
          advisory.hidden = false;
        }
      }
      this.node("elevation-cursor").setAttribute(
        "x1",
        String((t.track.station / t.track.length) * 220),
      );
      this.node("elevation-cursor").setAttribute(
        "x2",
        String((t.track.station / t.track.length) * 220),
      );
    }
    this.node("speed-value").textContent = String(Math.round(t.speed * 3.6));
    this.node("scene-status").textContent = t.groundedCount
      ? `${t.groundedCount} WHEELS GROUNDED`
      : "CHASSIS AIRBORNE";
    this.node("front-weight").textContent =
      `${Math.round(t.frontLoadFraction * 100)}%`;
    this.node("rear-weight").textContent =
      `${Math.round((1 - t.frontLoadFraction) * 100)}%`;
    this.node("axle-total").textContent =
      `${(t.totalLoad / 1000).toFixed(1)} kN`;
    this.node("weight-bar-fill").style.width = `${t.frontLoadFraction * 100}%`;
    this.node("performance-status").textContent =
      `${Math.round(fps)} FPS · ${physicsMs.toFixed(1)} MS SIM`;
    this.node("input-status").textContent = inputName
      ? "GAMEPAD CONNECTED"
      : "KEYBOARD / GAMEPAD READY";
    this.node("throttle-meter").style.height = `${t.controls.throttle * 100}%`;
    this.node("brake-meter").style.height = `${t.controls.brake * 100}%`;
    this.trace.update();
    this.inputSettings.update(t.controls, inputName);
  }
  toast(message: string) {
    const toast = this.node("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      toast.hidden = true;
    }, 3500);
  }
  setUndoEnabled(enabled: boolean) {
    (this.node("undo-button") as HTMLButtonElement).disabled = !enabled;
  }
  setRedoEnabled(enabled: boolean) {
    (this.node("redo-button") as HTMLButtonElement).disabled = !enabled;
  }
  get hasPendingChanges() {
    return Array.from(STRUCTURAL_KEYS).some(
      (key) => this.setup[key] !== this.draft[key],
    );
  }
  setCompareEnabled(enabled: boolean) {
    (this.node("compare-button") as HTMLButtonElement).disabled = !enabled;
  }
  setComparing(on: boolean) {
    this.node("compare-button").innerHTML =
      `${icon("compare")}${on ? "Return to edit" : "Compare saved"}`;
  }
  dispose() {
    this.generator.dispose();
    this.cars.dispose();
    this.garage.dispose();
    this.trace.dispose();
    this.inputSettings.dispose();
    this.abort.abort();
    clearTimeout(this.toastTimeout);
  }
}
