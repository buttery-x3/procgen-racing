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
import { GenerationClient } from "../track/GenerationClient";
import { hydrateCircuit } from "../track/SurfaceCompiler";
import type { CompiledCircuit } from "../track/SurfaceCompiler";
import type {
  GenerationRecipe,
  GenerationResult,
} from "../track/generationTypes";
import { CircuitView } from "../rendering/CircuitView";
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
  private readonly generation = new GenerationClient();
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
      driver?: (
        telemetry: VehicleTelemetry,
        setup: VehicleSetup,
        circuit: CompiledCircuit,
      ) => VehicleControls;
      onLap?: (lap: CompletedLap) => void;
      storage?: SoloStorage;
    },
  ) {
    this.soloStorage = diagnostics?.storage ?? new SoloStorage();
  }

  async initialize(root: HTMLElement) {
    await initializePhysics();
    if (this.disposed) return;
    const setup = this.savedSetup ?? DEFAULT_SETUP;
    this.rig = new SuspensionRig(setup);
    this.surfaceAudio.setSetup(setup);
    this.rig.setExperiment("circuit");
    // Open on a settled chassis; the drop button remains a repeatable explicit test.
    for (let i = 0; i < 360; i++) this.rig.step();
    this.workbench = new Workbench(
      root,
      setup,
      {
        action: (action) => this.action(action),
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
    );
    if (this.savedSetup) this.workbench.setSetup(setup);
    this.workbench.setExperiment("circuit");
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
  }

  private async generatePreview(
    recipe: GenerationRecipe,
    archive?: CircuitArchive,
  ) {
    const version = ++this.previewVersion;
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
        (await this.generation.generate(
          recipe,
          (progress) => {
            if (version === this.previewVersion && !this.disposed)
              this.workbench.generator.progress(progress);
          },
          venue,
          cached,
          archive,
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

  private loadCircuit(circuit: CompiledCircuit, archive?: CircuitArchive) {
    this.surfaceAudio.silence();
    // Build the view before changing physics. Both preparation failures keep the
    // current scene; successful replacement releases all previous mesh/colliders.
    const nextView = new CircuitView(circuit);
    try {
      this.session?.abandon("Circuit changed");
      this.rig.setCircuit(circuit);
    } catch (error) {
      nextView.dispose();
      throw error;
    }
    this.view.setCircuit(nextView);
    this.workbench.setCircuit(circuit);
    this.view.remember(this.rig.telemetry, true);
    this.view.setCamera("chase");
    this.workbench.setCamera("chase");
    this.configureSession();
    this.workbench.library.setCurrent(archive, circuit.distance);
    this.accumulator = 0;
    this.paused = false;
    this.workbench.setPaused(false);
    this.workbench.update(
      this.rig.telemetry,
      this.fps,
      0,
      this.input.gamepadName,
    );
    this.workbench.generator.close();
    this.workbench.toast(
      `${circuit.definition.name} loaded. Your vehicle setup is retained.`,
    );
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
    this.session?.abandon("Car or setup changed");
    if (remember) {
      if (!identical) this.setupHistory.record(this.rig.setup, group);
    }
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
    this.rig.updateSetup(next, structural);
    this.surfaceAudio.setSetup(next);
    this.configureSession();
    if (structural || visual) {
      this.view.buildCar(next);
    }
    if (structural) {
      this.view.remember(this.rig.telemetry, true);
      this.accumulator = 0;
      this.workbench.toast(
        "Chassis rebuilt. Dimensions and mass properties applied.",
      );
    }
    if (refresh) this.workbench.setSetup(next);
    this.workbench.setUndoEnabled(this.setupHistory.canUndo);
    this.workbench.setRedoEnabled(this.setupHistory.canRedo);
    if (this.comparisonReturn && remember) {
      this.comparisonReturn = null;
      this.workbench.setComparing(false);
    }
  }

  private action(action: string) {
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
      this.previewVersion++;
      this.generation.cancel();
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
      this.rig.setExperiment(experiment);
      this.configureSession();
      this.view.remember(this.rig.telemetry, true);
      this.workbench.setExperiment(experiment);
      if (experiment === "circuit") {
        this.view.setCamera("chase");
        this.workbench.setCamera("chase");
      } else if (this.view.cameraMode === "overview") {
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
      this.view.setCamera(mode);
      this.workbench.setCamera(mode);
    } else if (action === "cycle-camera") {
      const modes = ["chase", "bonnet", "top", "orbit"] as const;
      this.action(
        `camera:${modes[(modes.findIndex((mode) => mode === this.view.cameraMode) + 1) % 3]}`,
      );
    } else if (action === "session:trial" || action === "session:practice") {
      if (this.workbench.hasPendingChanges) {
        this.workbench.toast(
          "Apply or discard pending chassis changes before starting a session.",
        );
        return;
      }
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
      if (this.workbench.hasPendingChanges) {
        this.workbench.toast(
          "Apply the pending chassis changes before saving this setup.",
        );
        return;
      }
      try {
        saveSetup(this.rig.setup);
        this.savedSetup = copySetup(this.rig.setup);
        this.workbench.setSavedReference(this.savedSetup);
        this.workbench.setCompareEnabled(true);
        this.workbench.toast(
          "Setup saved in this browser. It will be restored next time.",
        );
      } catch {
        this.workbench.toast(
          "Browser storage is unavailable. Your current setup is still active.",
        );
      }
    } else if (action === "compare" && this.savedSetup) {
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
      oldCourse,
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
  private async driveArchive(archive: CircuitArchive) {
    const version = ++this.previewVersion;
    const result = await this.generation.generate(
      archive.recipe,
      (progress) => this.workbench.library.status(progress.stage),
      archive.definition.venue?.settings ?? DEFAULT_VENUE,
      undefined,
      archive,
    );
    if (this.disposed || version !== this.previewVersion) return;
    if (
      !result.report.valid ||
      result.report.checks.some((c) => c.status === "fail")
    )
      throw new Error("Saved circuit failed current construction validation.");
    this.loadCircuit(hydrateCircuit(result.circuit), circuitArchive(result));
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
          )
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

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("blur", this.blur);
    this.contextVersion++;
    this.generation.dispose();
    this.surfaceAudio.dispose();
    this.previewCache.clear();
    this.input?.dispose();
    this.workbench?.dispose();
    this.view?.dispose();
    this.rig?.dispose();
  }
}
