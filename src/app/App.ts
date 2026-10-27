import { prepareWorkspace } from "./PreparedWorkspace";
import { CircuitPreparation } from "../track/Preparation";
import { CarValidationClient } from "../vehicle/CarValidationClient";
import { commandDefinition, nextCamera } from "../workbench/commands";
import { CATEGORIES, randomCategory, explorationRecipe, categoryName } from "../exploration/catalog";
import type { Category } from "../exploration/catalog";
import { decodeSelection, loadSelection, saveSelection } from "../exploration/selection";
import type { ExplorationSelection } from "../exploration/selection";
import { mechanicsFingerprint, fingerprint, carIdentity } from "../vehicle/CarDefinition";
import { downloadJSON } from "../workbench/ui";
import type { TimingCourse } from "../race/TimingCourse";
import { Input } from "../input/Input";
import { initializePhysics, SuspensionRig } from "../physics/SuspensionRig";
import { SceneView } from "../rendering/SceneView";
import { loadSetup, saveSetup } from "../storage/SetupStorage";
import {
  DEFAULT_SETUP,
  PRESETS,
  sanitizeSetup,
  STRUCTURAL_KEYS,
} from "../vehicle/setup";
import { FIXED_STEP, WHEEL_IDS } from "../vehicle/types";
import type {
  Experiment,
  VehicleSetup,
  VehicleControls,
  VehicleTelemetry,
} from "../vehicle/types";
import { Workbench } from "../workbench/Workbench";
import { REFERENCE_CARS } from "../vehicle/referenceCars";
import { signedForwardSpeed } from "../vehicle/coordinates";
import { getTestCircuit } from "../track/testCircuit";
import { hydrateCircuit } from "../track/SurfaceCompiler";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type {
  GenerationRecipe,
  GenerationResult,
} from "../track/generationTypes";
import { VehicleAudio } from "../audio/VehicleAudio";
import { venueGeometrySettings } from "../track/venue/types";
import { SetupHistory, copySetup } from "../storage/GarageStorage";
import { generateCar } from "../vehicle/generateCar";
import type { CircuitArchive } from "../storage/CircuitStorage";
import { circuitArchive } from "../storage/CircuitStorage";
import {
  SoloStorage,
  decodeSession,
  exportSession,
} from "../storage/SoloStorage";
import { sessionIdentity } from "../race/identity";
import { RaceSession } from "../race/RaceSession";
import type { CompletedLap, SavedSession, SessionMode } from "../race/types";
import type { GhostData } from "../race/Ghost";
import type { PresentationSettings } from "../rendering/settings";
import { DEFAULT_VENUE } from "../track/venue/types";

export class App {
  private rig!: SuspensionRig;
  private view!: SceneView;
  private workbench!: Workbench;
  private input!: Input;
  private paused = false;
  private disposed = false;
  private previousEffectivePause = false;
  private frame = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private lastUIUpdate = 0;
  private fps = 60;
  private setupHistory = new SetupHistory();
  private savedSetup: VehicleSetup | null = loadSetup();
  private comparisonReturn: VehicleSetup | null = null;
  private readonly generation = new CircuitPreparation();
  private readonly carValidation = new CarValidationClient();
  private selection?: ExplorationSelection;
  private previousTrack?: CircuitArchive;
  private activeArchive?: CircuitArchive;
  private selectionCustom = false;
  private pendingCategory?: Category;
  private startupPending = false;
  private readonly surfaceAudio = new VehicleAudio();
  private preview?: GenerationResult;
  private previewVersion = 0;
  private readonly previewCache = new Map<string, GenerationResult>();
  private session!: RaceSession;
  private readonly soloStorage: SoloStorage;
  private contextVersion = 0;
  private storageQueue: Promise<void> = Promise.resolve();
  private importedReference?: { record: SavedSession; ghost: GhostData };
  constructor(
    private diagnostics?: {
      deterministic?: boolean;
      driver?: (
        telemetry: VehicleTelemetry,
        setup: VehicleSetup,
        circuit: CompiledCircuit,
      ) => VehicleControls | undefined;
      onLap?: (lap: CompletedLap) => void;
      storage?: SoloStorage;
      /** Dedicated diagnostic pages may select a repeatable setup and existing test pad. */
      setup?: VehicleSetup;
      experiment?: Experiment;
    },
  ) {
    this.soloStorage = diagnostics?.storage ?? new SoloStorage();
  }

  async initialize(root: HTMLElement) {
    await initializePhysics();
    if (this.disposed) return;
    const setup = this.diagnostics?.setup ?? (this.diagnostics?.deterministic ? this.savedSetup : undefined) ?? DEFAULT_SETUP;
    const experiment = this.diagnostics?.experiment ?? "circuit";
    this.rig = new SuspensionRig(setup);
    this.surfaceAudio.setSetup(setup);
    this.rig.setExperiment(experiment);
    // Open on a settled chassis; the drop button remains a repeatable explicit test.
    for (let i = 0; i < 360; i++) this.rig.step();
    this.workbench = new Workbench(
      root,
      setup,
      {
        action: (action) => this.action(action),
        inputBoundary: () => this.input?.clear(),
        pairingImport: (raw) => { try { void this.explore(undefined, decodeSelection(raw)); } catch (e) { this.workbench.toast(String(e)); } },
        setup: (next, rebuild, group) =>
          this.applySetup(next, false, true, rebuild, group),
        generate: (recipe, archive) =>
          void this.generatePreview(recipe, archive),
        input: (settings) => this.input.configure(settings),
        sessionExport: () => this.exportSession(),
        sessionImport: (raw) => this.importSession(raw),
        presentation: (settings) => this.presentation(settings),
        audio: (settings) => {
          this.surfaceAudio.configure(settings);
          this.workbench?.setSound(settings.enabled);
        },
        driveArchive: (archive) => this.driveArchive(archive),
        storage: this.soloStorage,
      },
      !!this.savedSetup,
      this.savedSetup ?? undefined,
    );
    if (this.savedSetup) this.workbench.setSavedReference(this.savedSetup);
    this.workbench.setSetup(setup);
    this.workbench.setCircuit(this.rig.circuit);
    this.workbench.setExperiment(experiment);
    this.view = new SceneView(this.workbench.viewport, setup, getTestCircuit());
    this.view.remember(this.rig.telemetry, true);
    this.view.setCamera("chase");
    this.workbench.setCamera("chase");
    this.configureSession("practice");
    this.presentation(this.workbench.sessions.settings);
    this.surfaceAudio.configure(this.workbench.audio.settings);
    this.surfaceAudio.onStatus = () => {
      this.workbench.setSound(this.surfaceAudio.enabled);
      this.workbench.audio.setRuntimeStatus(this.surfaceAudio.state);
      const button = root.querySelector<HTMLButtonElement>("#surface-sound-button");
      if (button) button.title = this.surfaceAudio.state === "ready"
        ? "Sound is on; starts with your first driving key or pointer interaction."
        : this.surfaceAudio.state === "unavailable" ? "Audio unavailable; toggle sound to retry."
        : "Toggle driving sound";
    };
    this.surfaceAudio.attach();
    this.surfaceAudio.capture(this.rig.telemetry, this.rig.setup);
    this.input = new Input((action) =>
      this.action(
        {
          KeyR: "reset",
          Space: "pause",
          KeyC: "cycle-camera",
          KeyV: "gear:toggle",
          KeyQ: "shift:down",
          KeyE: "shift:up",
        }[action] ?? action,
      ),
    );
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("blur", this.blur);
    this.frame = requestAnimationFrame(this.animate);
    if (!this.diagnostics?.deterministic) { this.startupPending = true; void this.explore(randomCategory()); }
  }

  private async generatePreview(
    recipe: GenerationRecipe,
    archive?: CircuitArchive,
  ) {
    this.cancelPreparation();
    const version = this.previewVersion;
    this.preview = undefined;
    try {
      const venue = this.workbench.generator.venueSettings();
      const key = JSON.stringify({
        recipe,
        venue,
        archive: archive?.definitionHash,
      });
      const cached = [...this.previewCache.values()]
        .reverse()
        .find(
          (r) =>
            JSON.stringify(r.recipe) === JSON.stringify(recipe) &&
            r.circuit.definition.venue &&
            JSON.stringify(
              venueGeometrySettings(r.circuit.definition.venue.settings),
            ) === JSON.stringify(venueGeometrySettings(venue)),
        );
      const result =
        this.previewCache.get(key) ??
        (await this.generation.prepare(
          recipe,
          venue,
          (progress) => {
            if (version === this.previewVersion && !this.disposed)
              this.workbench.generator.progress(progress);
          },
          archive,
          cached,
        ));
      if (version !== this.previewVersion || this.disposed) return;
      this.preview = result;
      this.previewCache.delete(key);
      this.previewCache.set(key, result);
      while (
        this.previewCache.size > 1 &&
        (this.previewCache.size > 3 ||
          [...this.previewCache.values()].reduce(
            (n, r) =>
              n +
              r.circuit.chunks.reduce(
                (s, c) =>
                  s +
                  c.vertices.byteLength +
                  c.indices.byteLength +
                  c.colors.byteLength,
                0,
              ),
            0,
          ) >
            48 * 1024 * 1024)
      )
        this.previewCache.delete(this.previewCache.keys().next().value!);
      this.workbench.generator.ready(result);
    } catch (error) {
      if (
        version !== this.previewVersion ||
        this.disposed ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      this.workbench.generator.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private commitWorkspace(next: ReturnType<typeof prepareWorkspace>, archive: CircuitArchive | undefined, remember: boolean, mode: SessionMode = "practice", clearComparison = true) {
    const old = this.rig;
    if (remember) this.setupHistory.record(old.setup);
    this.session?.abandon("Workspace changed");
    this.surfaceAudio.silence();
    this.rig = next.rig;
    next.car.commit();
    this.view.setCircuit(next.road);
    next.timing?.commit();
    next.release();
    this.activeArchive = archive;
    if (clearComparison) { this.comparisonReturn = null; this.workbench.setComparing(false); }
    this.workbench.setWorkspace(this.rig.setup, this.rig.circuit, this.rig.experiment, this.rig.circuitStart);
    this.workbench.setUndoEnabled(this.setupHistory.canUndo);
    this.workbench.setRedoEnabled(this.setupHistory.canRedo);
    this.workbench.library.setCurrent(archive, this.rig.circuit.distance);
    this.view.remember(this.rig.telemetry, true);
    this.view.setCamera("chase"); this.workbench.setCamera("chase");
    this.configureSession(mode, next.course);
    this.surfaceAudio.setSetup(this.rig.setup);
    this.input.clear(); this.accumulator = 0;
    this.workbench.setPaused(this.paused);
    old.dispose();
  }
  private loadCircuit(circuit: CompiledCircuit, archive?: CircuitArchive, testing = false) {
    if (!this.workbench.authorize("experiment:circuit")) return;
    this.cancelPreparation();
    const next = prepareWorkspace(this.view, this.rig.setup, circuit);
    try { this.commitWorkspace(next, archive, false); } finally { next.dispose(); }
    if (!testing) { this.selectionCustom = true; this.previousTrack = archive; }
    this.updateSelectionContext();
    this.workbench.generator.close();
    this.workbench.toast(`${circuit.definition.name} loaded. Your vehicle setup is retained.`);
  }

  private cancelPreparation() {
    this.previewVersion++;
    this.generation.cancel(); this.carValidation.cancel();
    this.pendingCategory = undefined;
    this.workbench?.chrome.setCategory(this.selectionCustom ? undefined : this.selection?.category);
    this.workbench?.setPreparation();
  }
  private updateSelectionContext() {
    const s = this.selection;
    const custom = this.selectionCustom || (!!s && fingerprint(this.rig.setup.vehicle) !== fingerprint(s.factory.vehicle));
    this.workbench.chrome.setCategory(custom ? undefined : s?.category, this.pendingCategory);
    const detail = this.workbench.node("pairing-detail");
    detail.textContent = s ? `${custom ? "Custom · from " : ""}${categoryName(s.category)} · seed ${s.seed} · attempt ${s.attempt + 1} · car ${s.car.seed} · mechanics ${s.car.mechanicsSeed} · proportions ${s.car.proportionsSeed} · appearance ${s.car.appearanceSeed} · track ${s.track.seed} · scenery ${s.venue.scenerySeed} · catalog ${s.catalog}.` : "Custom / authored proving circuit. Manual recipes remain available in the workshops.";
    this.workbench.node("active-setup-state").textContent = this.workbench.hasPendingChanges ? "PENDING CHASSIS" : s && mechanicsFingerprint(this.rig.setup) !== s.mechanics ? "MODIFIED" : custom ? "CUSTOM" : "";
  }
  private async explore(category?: Category, repeat?: ExplorationSelection) {
    if (!this.workbench.authorize("explore:new")) return;
    this.cancelPreparation();
    const token = this.previewVersion;
    category = repeat?.category ?? category ?? this.selection?.category ?? randomCategory();
    const rootSeed = repeat?.seed ?? crypto.randomUUID();
    this.pendingCategory = category;
    this.workbench.chrome.setCategory(this.selectionCustom ? undefined : this.selection?.category, category);
    const failures: string[] = [];
    for (let attempt = repeat?.attempt ?? 0; attempt < (repeat ? repeat.attempt + 1 : 3); attempt++) {
      let staged: ReturnType<typeof prepareWorkspace> | undefined;
      try {
        const recipe = repeat ?? explorationRecipe(category, rootSeed, attempt);
        this.workbench.setPreparation(`Preparing ${categoryName(category)} · ${attempt + 1}/3 · checking vehicle…`, true);
        const car = generateCar(recipe.car);
        if (!car.valid) throw new Error(car.checks.filter((c) => !c.passed).map((c) => c.detail).join("; "));
        const physical = await this.carValidation.validate(car.setup);
        if (this.disposed || token !== this.previewVersion) return;
        if (!physical.valid) throw new Error(physical.detail);
        const result = await this.generation.prepare(recipe.track, recipe.venue, (p) => this.workbench.setPreparation(`Preparing ${categoryName(category)} · ${p.stage}`, true), repeat?.archive);
        if (this.disposed || token !== this.previewVersion) return;
        if (result.fallback) throw new Error("Generator returned a fallback instead of the selected recipe.");
        const circuit = hydrateCircuit(result.circuit), archive = circuitArchive(result);
        staged = prepareWorkspace(this.view, car.setup, circuit);
        // Allow cancellation/intent changes before replacing the active pair at a frame boundary.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (this.disposed || token !== this.previewVersion || this.workbench.hasPendingChanges) return;
        this.commitWorkspace(staged, archive, true);
        this.selection = { ...recipe, format: "procgen-racing/exploration", factory: copySetup(car.setup), archive, mechanics: mechanicsFingerprint(car.setup), circuitFingerprint: result.fingerprint };
        this.selectionCustom = false; this.previousTrack = archive; this.preview = result;
        this.workbench.generator.setSelection(recipe.track, recipe.venue, result);
        const stored = saveSelection(this.selection);
        this.pendingCategory = undefined; this.startupPending = false;
        this.workbench.setPreparation(); this.updateSelectionContext();
        this.workbench.toast(`${categoryName(category)} ready · ${car.definition.name}${stored ? "" : " · pairing storage unavailable; export to keep it"}`);
        return;
      } catch (e) {
        if (this.disposed || token !== this.previewVersion || (e instanceof DOMException && e.name === "AbortError")) return;
        failures.push(e instanceof Error ? e.message : String(e));
      } finally { staged?.dispose(); }
    }
    if (token !== this.previewVersion) return;
    this.pendingCategory = undefined; this.updateSelectionContext();
    if (this.startupPending) { this.paused = true; this.workbench.setPaused(true); }
    this.workbench.setPreparation(`Could not prepare ${categoryName(category)}. ${failures.join(" / ")}`, false);
  }

  private applySetup(
    setup: VehicleSetup,
    refresh = true,
    remember = true,
    rebuild = false,
    group = "",
  ) {
    const next = sanitizeSetup(setup);
    const identical = JSON.stringify(next) === JSON.stringify(this.rig.setup);
    if (identical && !rebuild) return;
    this.cancelPreparation();
    const structure = (s: VehicleSetup) =>
      s.vehicle && {
        family: s.vehicle.family,
        dimensions: s.vehicle.dimensions,
        shape: s.vehicle.shape,
        components: s.vehicle.components,
      };
    const visual =
      JSON.stringify(next.vehicle?.appearance) !==
      JSON.stringify(this.rig.setup.vehicle?.appearance);
    const structural =
      rebuild ||
      JSON.stringify(structure(next)) !==
        JSON.stringify(structure(this.rig.setup)) ||
      Array.from(STRUCTURAL_KEYS).some(
        (key) => next[key] !== this.rig.setup[key],
      );
    if (structural) {
      const prepared = prepareWorkspace(this.view, next, this.rig.circuit, this.rig.experiment, this.rig.circuitStart);
      try { this.commitWorkspace(prepared, this.activeArchive, remember, this.session.mode, remember); } finally { prepared.dispose(); }
      this.updateSelectionContext();
      return;
    }
    const preparedCar = visual ? this.view.prepareCar(next) : undefined;
    this.session?.abandon("Car or setup changed");
    if (remember && !identical) this.setupHistory.record(this.rig.setup, group);
    this.rig.updateSetup(next, false);
    this.surfaceAudio.setSetup(next);
    this.configureSession();
    preparedCar?.commit();
    if (refresh) this.workbench.setSetup(next);
    this.workbench.setUndoEnabled(this.setupHistory.canUndo);
    this.workbench.setRedoEnabled(this.setupHistory.canRedo);
    this.updateSelectionContext();
    if (this.comparisonReturn && remember) {
      this.comparisonReturn = null;
      this.workbench.setComparing(false);
    }
  }

  private action(action: string) {
    try { this.executeAction(action); }
    catch (error) { this.workbench.toast(`Action could not complete. ${error instanceof Error ? error.message : String(error)}`); }
  }
  private executeAction(action: string) {
    if (action === "draft:changed") { this.cancelPreparation(); this.updateSelectionContext(); return; }
    if (!this.workbench.authorize(action)) return;
    const definition = commandDefinition(action);
    if (definition.effect !== "view" && !action.startsWith("explore:") && !action.startsWith("category:")) this.cancelPreparation();
    if (action.startsWith("category:")) {
      const category = action.slice(9) as Category;
      if (category === this.workbench.chrome.selectedCategory && this.rig.experiment === "circuit") { if (this.pendingCategory) this.cancelPreparation(); return; }
      if (CATEGORIES.includes(category) && (category !== this.workbench.chrome.selectedCategory || this.rig.experiment !== "circuit")) void this.explore(category);
      return;
    }
    if (action.startsWith("explore:")) {
      if (action === "explore:cancel") { this.cancelPreparation(); return; }
      if (action === "explore:export") { if (this.selection) downloadJSON(`pairing-${this.selection.seed}.json`, JSON.stringify(this.selection, null, 2)); else this.workbench.toast("Select a category first."); return; }
      if (action === "explore:repeat") { if (this.selection) void this.explore(undefined, this.selection); else this.workbench.toast("Select a category first."); return; }
      if (action === "explore:restore") { const last = loadSelection(); if (last) void this.explore(undefined, last); else this.workbench.toast("No valid saved pairing is available."); return; }
      void this.explore(action === "explore:random" ? randomCategory() : undefined); return;
    }
    if (action === "load-baseline") { if (this.savedSetup) this.applySetup(this.savedSetup, true, true, true); else this.workbench.toast("No saved baseline is available."); return; }
    if (action === "track:return") { if (this.previousTrack) void this.driveArchive(this.previousTrack, true).catch((e) => this.workbench.toast(String(e))); else this.loadCircuit(getTestCircuit(), undefined, true); return; }

    if (["reset", "home", "drop"].includes(action) ||
        /^(experiment:|start:|session:(trial|practice))/.test(action))
      this.surfaceAudio.silence();
    if (action === "surface-sound") {
      this.workbench.audio.setEnabled(!this.surfaceAudio.enabled);
    } else if (action === "audio:stop") {
      this.surfaceAudio.stopAudition();
    } else if (/^audio:(demo|channel):/.test(action)) {
      const id = WHEEL_IDS.find((wheel) => action.endsWith(":" + wheel));
      if (id) this.surfaceAudio.demo(id, action.startsWith("audio:channel:"));
    } else if (
      action === "generator:cancel" ||
      action === "generator:invalidate"
    ) {
      this.cancelPreparation();
      if (action.endsWith("invalidate")) this.preview = undefined;
    } else if (
      action === "generator:drive" ||
      action === "generator:authored"
    ) {
      const result = this.preview;
      if (
        action === "generator:drive" &&
        (!result ||
          !result.report.valid ||
          !this.workbench.generator.isCurrent(result))
      )
        return;
      try {
        this.loadCircuit(
          action.endsWith("authored")
            ? getTestCircuit()
            : hydrateCircuit(result!.circuit),
          action.endsWith("authored") ? undefined : circuitArchive(result!),
        );
        if (action.endsWith("drive"))
          this.workbench.generator.rememberRecipe(result!.recipe);
      } catch (error) {
        this.workbench.generator.error(
          `Could not load circuit: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (action.startsWith("circuit-start:")) {
      this.session.abandon("Test start changed");
      this.rig.setCircuitStart(action.slice(14));
      this.configureSession();
      this.view.remember(this.rig.telemetry, true);
      this.workbench.setExperiment("circuit");
      this.workbench.setCircuitStart(this.rig.circuitStart);
      this.view.setCamera("chase");
      this.workbench.setCamera("chase");
      this.accumulator = 0;
      this.paused = false;
      this.workbench.setPaused(false);
    } else if (action.startsWith("car:")) {
      const car =
        REFERENCE_CARS[action.slice(4) as VehicleSetup["referenceCar"]];
      if (!car) return;
      this.applySetup(car.setup, true, true, true);
      this.workbench.setSetup(car.setup, "balanced");
      this.workbench.toast(`${car.name} · ${car.description}`);
    } else if (action.startsWith("gear:") || action.startsWith("shift:")) {
      const speed = signedForwardSpeed(
        this.rig.telemetry.velocity,
        this.rig.telemetry.rotation,
      );
      const gear =
        action === "gear:reverse"
          ? -1
          : action === "gear:neutral"
            ? 0
            : action === "gear:toggle"
              ? this.rig.powertrain.gear < 0
                ? 1
                : -1
              : 1;
      const accepted = action.startsWith("shift:")
        ? this.rig.powertrain.shift(action.endsWith("up") ? 1 : -1, speed)
        : this.rig.powertrain.requestGear(gear, speed);
      this.workbench.toast(
        accepted
          ? `Gear ${this.rig.powertrain.gear < 0 ? "R · W / right trigger to reverse" : this.rig.powertrain.gear === 0 ? "N · neutral" : this.rig.powertrain.gear} selected.`
          : "Stop the car before changing direction.",
      );
    } else if (action.startsWith("assists:")) {
      const bundles: Record<string, Partial<VehicleSetup>> = {
        accessible: {
          tractionControl: 1,
          abs: 1,
          stabilityAssist: 0.85,
          countersteerAssist: 0.65,
          speedSteering: 0.85,
          autoHold: 1,
        },
        balanced: {
          tractionControl: 0.65,
          abs: 1,
          stabilityAssist: 0.45,
          countersteerAssist: 0.3,
          speedSteering: 0.65,
          autoHold: 1,
        },
        direct: {
          tractionControl: 0,
          abs: 0,
          stabilityAssist: 0,
          countersteerAssist: 0,
          speedSteering: 0.25,
          autoHold: 1,
        },
        drift: {
          tractionControl: 0,
          abs: 1,
          stabilityAssist: 0.05,
          countersteerAssist: 0.5,
          speedSteering: 0.4,
          autoHold: 1,
        },
      };
      const bundle = bundles[action.slice(8)];
      if (bundle) {
        this.applySetup({ ...this.rig.setup, ...bundle });
        this.workbench.toast(`${action.slice(8)} driving assists applied.`);
      }
    } else if (action === "pause") {
      this.paused = !this.paused;
      if (this.paused) this.session.invalidate("Session paused");
      this.workbench.setPaused(this.paused);
      this.accumulator = 0;
    } else if (action === "reset" || action === "home") {
      this.session.abandon("Vehicle reset");
      this.rig.reset();
      this.session.restart(this.session.mode, this.rig.telemetry);
      this.view.remember(this.rig.telemetry, true);
      this.accumulator = 0;
      if (action === "home") {
        this.view.homeCamera();
        this.workbench.setCamera("orbit");
      }
      this.workbench.toast("Vehicle reset on the current test surface.");
    } else if (action === "drop") {
      this.session.abandon("Drop test used");
      this.rig.drop();
      this.session.restart(this.session.mode, this.rig.telemetry);
      this.view.remember(this.rig.telemetry, true);
      this.accumulator = 0;
      this.paused = false;
      this.workbench.setPaused(false);
      this.workbench.toast("Drop test running · 0.6 m release");
    } else if (action === "roll-pulse" || action === "pitch-pulse") {
      this.session.invalidate("Test impulse used");
      this.rig.impulse(action === "roll-pulse" ? "roll" : "pitch");
      this.paused = false;
      this.workbench.setPaused(false);
      this.workbench.toast(
        `${action === "roll-pulse" ? "Roll" : "Pitch"} impulse applied. Watch the body settle.`,
      );
    } else if (action.startsWith("experiment:")) {
      this.session.abandon("Test surface changed");
      const experiment = action.slice(11) as Experiment;
      if (experiment === "circuit") { this.loadCircuit(getTestCircuit(), undefined, true); return; }
      this.rig.setExperiment(experiment);
      this.configureSession();
      this.view.remember(this.rig.telemetry, true);
      this.workbench.setExperiment(experiment);
      if (this.view.cameraMode === "overview") {
        this.view.homeCamera();
        this.workbench.setCamera("orbit");
      }
      this.accumulator = 0;
      this.paused = false;
      this.workbench.setPaused(false);
    } else if (action.startsWith("camera:")) {
      const mode = action.slice(7) as
        | "orbit"
        | "chase"
        | "bonnet"
        | "top"
        | "overview";
      if (mode === "overview" && this.rig.experiment !== "circuit") return;
      this.view.setCamera(mode);
      this.workbench.setCamera(mode);
    } else if (action === "cycle-camera") {
      this.action(`camera:${nextCamera(this.view.cameraMode)}`);
    } else if (action === "session:trial" || action === "session:practice") {
      this.session.abandon("New session started");
      this.rig.setCircuitStart(this.rig.circuit.definition.starts[0].id);
      this.workbench.setExperiment("circuit");
      this.workbench.setCircuitStart(this.rig.circuitStart);
      this.configureSession(
        action.endsWith("trial") ? "time-trial" : "practice",
      );
      this.view.remember(this.rig.telemetry, true);
      this.view.setCamera("chase");
      this.workbench.setCamera("chase");
      this.accumulator = 0;
      this.paused = false;
      this.workbench.setPaused(false);
      this.workbench.toast(
        action.endsWith("trial")
          ? "Time trial ready. Cross the chequered line ahead to start the clock."
          : "Practice started. Laps are timed without setting personal bests.",
      );
    } else if (action === "session:local-reference") {
      this.importedReference = undefined;
      void this.loadSessionReference(this.contextVersion);
    } else if (action === "forces") {
      this.view.forcesVisible = !this.view.forcesVisible;
      this.workbench.setForces(this.view.forcesVisible);
    } else if (action === "defaults" || action.startsWith("preset:")) {
      const name = action === "defaults" ? "balanced" : action.slice(7);
      if (!PRESETS[name]) return;
      const factory = this.rig.setup.vehicle
        ? generateCar(this.rig.setup.vehicle.recipe).setup
        : REFERENCE_CARS[this.rig.setup.referenceCar].setup;
      const source = name === "balanced" ? factory : PRESETS[name].setup;
      const suspensionKeys = [
        "frontSpring",
        "rearSpring",
        "frontDamping",
        "rearDamping",
        "frontAntiRoll",
        "rearAntiRoll",
      ] as const;
      const selected = { ...this.rig.setup };
      for (const key of suspensionKeys)
        selected[key] =
          this.rig.setup.vehicle && name !== "balanced"
            ? (factory[key] * source[key]) / DEFAULT_SETUP[key]
            : source[key];
      this.applySetup(action === "defaults" ? factory : selected);
      this.workbench.setSetup(this.rig.setup, name);
      this.workbench.toast(
        `${PRESETS[name].label} setup · ${PRESETS[name].description}`,
      );
    } else if (action === "save") {
      try {
        saveSetup(this.rig.setup);
        this.savedSetup = copySetup(this.rig.setup);
        this.workbench.setSavedReference(this.savedSetup);
        this.workbench.setCompareEnabled(true);
        this.workbench.toast(
          "Baseline saved in this browser. Load it explicitly from the car menu.",
        );
      } catch {
        this.workbench.toast(
          "Browser storage is unavailable. Your current setup is still active.",
        );
      }
    } else if (action === "compare" && this.savedSetup) {
      if (!this.comparisonReturn && carIdentity(this.savedSetup) !== carIdentity(this.rig.setup)) { this.workbench.toast("The saved baseline belongs to a different car. Use Load saved baseline to replace the car."); return; }
      if (this.comparisonReturn) {
        const next = this.comparisonReturn;
        this.comparisonReturn = null;
        this.applySetup(next, true, false);
        this.workbench.setComparing(false);
        this.workbench.toast("Returned to your working setup.");
      } else {
        this.comparisonReturn = copySetup(this.rig.setup);
        this.applySetup(this.savedSetup, true, false);
        this.workbench.setComparing(true);
        this.workbench.toast(
          "Saved reference active. Use Return to edit to switch back.",
        );
      }
    } else if (action === "undo") {
      const setup = this.setupHistory.undo(this.rig.setup);
      if (!setup) return;
      this.applySetup(setup, true, false);
      this.workbench.setUndoEnabled(this.setupHistory.canUndo);
      this.workbench.setRedoEnabled(this.setupHistory.canRedo);
      this.workbench.toast("Setup change undone.");
    } else if (action === "redo") {
      const setup = this.setupHistory.redo(this.rig.setup);
      if (!setup) return;
      this.applySetup(setup, true, false);
      this.workbench.toast("Setup change redone.");
    }
  }

  private configureSession(
    mode: SessionMode = this.session?.mode ?? "practice",
    preparedCourse?: TimingCourse,
  ) {
    const version = ++this.contextVersion,
      circuit = this.rig.circuit,
      setup = this.rig.setup;
    const identity = sessionIdentity(circuit, setup),
      oldCourse = this.session?.course;
    this.importedReference = undefined;
    const trackName = circuit.definition.name,
      carName = setup.vehicle?.name ?? REFERENCE_CARS[setup.referenceCar].name;
    this.session = new RaceSession(
      circuit,
      identity,
      (lap) => this.persistLap(lap, trackName, carName),
      preparedCourse ?? oldCourse,
    );
    this.session.restart(mode, this.rig.telemetry);
    this.view.setTimingCourse(this.session.course);
    this.workbench.sessions.update(
      this.session.snapshot(),
      this.rig.experiment === "circuit",
    );
    void this.loadSessionReference(version);
  }
  private async loadSessionReference(version: number) {
    try {
      const session = this.session,
        { record, ghost } = await this.soloStorage.load(session.identity);
      if (
        this.disposed ||
        version !== this.contextVersion ||
        session !== this.session ||
        this.importedReference
      )
        return;
      if (record) {
        if (
          !session.best ||
          (record.best && record.best.duration < session.best.duration)
        )
          session.setReference(record.best, ghost);
        else if (!session.reference && !this.importedReference)
          session.setReference(session.best, ghost);
        session.recent = [
          ...session.recent,
          ...record.recent.filter(
            (r) => !session.recent.some((x) => x.id === r.id),
          ),
        ].slice(0, 8);
      } else session.setReference(session.best);
      this.workbench.sessions.setStatus(
        record?.best
          ? ghost
            ? "Personal best and its compatible ghost restored."
            : "Personal best restored. Its older ghost is no longer retained."
          : "No personal best for this circuit, car, setup and assists yet.",
      );
    } catch (error) {
      if (version === this.contextVersion)
        this.workbench.sessions.setStatus(
          `Local results unavailable: ${error instanceof Error ? error.message : String(error)}. Driving remains available.`,
        );
    }
  }
  private persistLap(lap: CompletedLap, trackName: string, carName: string) {
    this.diagnostics?.onLap?.(lap);
    if (lap.personalBest)
      this.workbench.toast(
        `Personal best · ${lap.result.duration.toFixed(3)} s. Saving lap and ghost…`,
      );
    this.storageQueue = this.storageQueue
      .then(async () => {
        await this.soloStorage.save(lap, trackName, carName);
        if (
          !this.disposed &&
          this.session.identity.key === lap.result.identity.key
        ) {
          this.session.recent = [
            lap.result,
            ...this.session.recent.filter((r) => r.id !== lap.result.id),
          ].slice(0, 8);
          this.workbench.sessions.setStatus(
            lap.personalBest
              ? "Personal best and ghost saved in this browser."
              : "Lap result saved.",
          );
        }
      })
      .catch((error) => {
        if (!this.disposed)
          this.workbench.sessions.setStatus(
            `Lap kept in memory; browser storage failed: ${error instanceof Error ? error.message : String(error)}. Export it before reloading.`,
          );
      });
  }
  private async exportSession() {
    await this.storageQueue;
    const session = this.session,
      ghost = session.reference?.data;
    if (!ghost)
      throw new Error(
        "Complete a valid timed lap or import a compatible reference before exporting a ghost.",
      );
    if (this.importedReference)
      return exportSession(this.importedReference.record, ghost);
    const snapshot = session.snapshot();
    if (!snapshot.best)
      throw new Error("There is no personal best for this session.");
    const record: SavedSession = {
      version: 1,
      identity: session.identity,
      trackName: this.rig.circuit.definition.name,
      carName: this.rig.setup.vehicle?.name ?? this.rig.setup.referenceCar,
      best: snapshot.best,
      recent: snapshot.recent,
      updatedAt: new Date().toISOString(),
      ghostAvailable: true,
    };
    return exportSession(record, ghost);
  }
  private importSession(raw: string) {
    try {
      const reference = decodeSession(raw, this.session.identity);
      this.session.setReference(this.session.best, reference.ghost, true);
      this.importedReference = reference;
      this.workbench.sessions.setStatus(
        "Imported ghost reference loaded. Your locally earned personal best is unchanged.",
      );
    } catch (error) {
      this.workbench.sessions.setStatus(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private presentation(settings: PresentationSettings) {
    this.view.configure(settings);
    // Audio mixer preferences have their own version and do not affect sessions.
  }
  private async driveArchive(archive: CircuitArchive, testing = false) {
    if (!this.workbench.authorize("track:return")) return;
    this.cancelPreparation();
    const version = this.previewVersion;
    try {
      const result = await this.generation.prepare(archive.recipe, archive.definition.venue?.settings ?? DEFAULT_VENUE,
        (progress) => this.workbench.library.status(progress.stage), archive);
      if (this.disposed || version !== this.previewVersion) return;
      this.loadCircuit(hydrateCircuit(result.circuit), circuitArchive(result), testing);
    } catch (e) { if ((e as Error).name !== "AbortError") throw e; }
  }

  private visibility = () => {
    this.accumulator = 0;
    this.lastFrame = 0;
    if (document.hidden) {
      this.surfaceAudio.silence();
      this.session?.invalidate("Session paused");
      this.paused = true;
      this.workbench.setPaused(true);
    }
  };
  private blur = () => {
    this.accumulator = 0;
    this.lastFrame = 0;
    this.paused = true;
    this.session?.invalidate("Window focus lost");
    this.surfaceAudio.silence();
    this.workbench?.setPaused(true);
  };

  private animate = (now: number) => {
    if (this.disposed) return;
    const rawDelta = this.lastFrame
      ? (now - this.lastFrame) / 1000
      : FIXED_STEP;
    this.lastFrame = now;
    const dt = Math.min(rawDelta, 0.08);
    if (rawDelta > 0.25 && !this.paused)
      this.session.invalidate("Long frame or suspended browser");
    this.fps += (1 / Math.max(rawDelta, 0.001) - this.fps) * 0.05;
    const modal = !!document.querySelector("dialog[open]");
    const effectivePause = this.paused || modal;
    if (effectivePause !== this.previousEffectivePause) {
      if (effectivePause) this.session.invalidate("Session paused");
      this.workbench.setPaused(effectivePause);
      this.accumulator = 0;
      this.view.remember(this.rig.telemetry);
      this.previousEffectivePause = effectivePause;
    }
    this.input.enabled = !effectivePause;
    const controls =
      this.diagnostics?.driver && !effectivePause
        ? this.diagnostics.driver(
            this.rig.telemetry,
            this.rig.setup,
            this.rig.circuit,
          ) ?? this.input.read(dt)
        : this.input.read(dt);
    const start = performance.now();
    if (!effectivePause) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 10) {
        this.view.remember(this.rig.telemetry);
        this.rig.step(controls);
        this.surfaceAudio.capture(this.rig.telemetry, this.rig.setup);
        if (this.rig.experiment === "circuit")
          this.session.step(this.rig.telemetry);
        this.workbench.recordTelemetry(
          this.rig.telemetry,
          this.rig.body.angvel().y,
        );
        this.accumulator -= FIXED_STEP;
        steps++;
      }
    } else this.accumulator = 0;
    const physicsMs = performance.now() - start;
    this.surfaceAudio.update(effectivePause || document.hidden);
    if (now - this.lastUIUpdate > 50) {
      this.workbench.update(
        this.rig.telemetry,
        this.fps,
        physicsMs,
        this.input.gamepadName,
      );
      this.lastUIUpdate = now;
      this.workbench.sessions.update(
        this.session.snapshot(),
        this.rig.experiment === "circuit",
      );
    }
    this.view.showGhost(
      this.rig.experiment === "circuit" &&
        this.workbench.sessions.settings.ghostVisible
        ? this.session.ghostPose(
            effectivePause ? 1 : this.accumulator / FIXED_STEP,
          )
        : null,
    );
    this.view.render(
      this.rig,
      effectivePause ? 1 : this.accumulator / FIXED_STEP,
      dt,
    );
    this.frame = requestAnimationFrame(this.animate);
  };

  audioDiagnostics() {
    return this.surfaceAudio.diagnostics();
  }
  /** Read-only state for the isolated workbench qualification page. */
  workbenchDiagnostics() {
    return {
      time: this.rig.telemetry.time, setup: mechanicsFingerprint(this.rig.setup), car: carIdentity(this.rig.setup),
      track: this.rig.circuit.definition.id, experiment: this.rig.experiment, start: this.rig.circuitStart,
      category: this.selection?.category ?? null, pendingCategory: this.pendingCategory ?? null,
      custom: this.selectionCustom, pendingDraft: this.workbench.hasPendingChanges,
      layout: { ...this.workbench.chrome.state }, captured: this.workbench.trace.captureSize,
      paused: this.paused, sessionKey: this.session.identity.key, sessionState: this.session.snapshot().state,
      grounded: this.rig.telemetry.groundedCount, camera: this.view.cameraMode,
      finite: [this.rig.telemetry.position.x, this.rig.telemetry.position.y, this.rig.telemetry.position.z].every(Number.isFinite),
      seed: this.selection?.seed ?? null,
    };
  }

  /** Snapshot the production RAF/physics/audio path without replacing its control publication. */
  audioDrivingDiagnostics() {
    const t = this.rig.telemetry;
    return {
      sampledAt: performance.now(), frameAgeMs: this.lastFrame ? performance.now() - this.lastFrame : null,
      paused: this.previousEffectivePause || this.paused || document.hidden,
      visibility: document.visibilityState, experiment: this.rig.experiment,
      telemetry: { time: t.time, speed: t.speed, rpm: t.powertrain.rpm, gear: t.powertrain.gear, shifting: t.powertrain.shifting, grounded: t.groundedCount },
      audio: this.surfaceAudio.signalDiagnostics(),
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("blur", this.blur);
    this.contextVersion++;
    this.carValidation.dispose();
    this.generation.dispose();
    this.surfaceAudio.dispose();
    this.previewCache.clear();
    this.input?.dispose();
    this.workbench?.dispose();
    this.view?.dispose();
    this.rig?.dispose();
  }
}
