export {};

const clips = [
  { id: "reference", label: "Real reference", file: "reference.wav" },
  { id: "reconstruction", label: "Reconstruction", file: "reconstruction.wav" },
  { id: "frozen", label: "Frozen character", file: "frozen.wav" },
  { id: "previous", label: "Previous playground", file: "previous.wav" },
] as const;
type ClipId = typeof clips[number]["id"];
const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing reference comparison element: ${id}`);
  return found as T;
};
const status = element<HTMLParagraphElement>("reference-status");
const pair = element<HTMLButtonElement>("play-pair"), all = element<HTMLButtonElement>("play-all");
const stopButton = element<HTMLButtonElement>("stop-reference");
const progress = element<HTMLProgressElement>("reference-progress");
const volume = element<HTMLInputElement>("reference-volume");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-clip]")];
let context: AudioContext | undefined, master: GainNode | undefined;
let source: AudioBufferSourceNode | undefined;
let voiceGain: GainNode | undefined;
let buffers: Map<ClipId, AudioBuffer> | undefined;
let loading: Promise<Map<ClipId, AudioBuffer>> | undefined;
let generation = 0, animation = 0, ready = false, duration = 0;

function highlight(id?: ClipId): void {
  for (const clip of clips) element(`card-${clip.id}`).classList.toggle("playing", clip.id === id);
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.clip === id));
}

function stop(): void {
  generation++;
  cancelAnimationFrame(animation);
  if (source) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
  voiceGain?.disconnect(); voiceGain = undefined;
  source = undefined; progress.value = 0; stopButton.disabled = true; highlight();
}

async function loadAudio(audioContext: AudioContext): Promise<Map<ClipId, AudioBuffer>> {
  if (buffers) return buffers;
  if (loading) return loading;
  loading = Promise.all(clips.map(async (clip) => {
    const response = await fetch(`/__audio-reference/${clip.file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`The local ${clip.label.toLowerCase()} file is unavailable`);
    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (Math.abs(buffer.duration - duration) > 0.02) throw new Error("Comparison files have different durations; prepare them again");
    return [clip.id, buffer] as const;
  })).then((entries) => { buffers = new Map(entries); return buffers; });
  try { return await loading; } finally { loading = undefined; }
}

async function play(ids: readonly ClipId[]): Promise<void> {
  if (!ready) return;
  stop();
  const token = generation;
  stopButton.disabled = false;
  status.textContent = "Opening the short comparison…";
  try {
    // Create/resume during the click gesture, before asynchronous file loading.
    if (!context || context.state === "closed") {
      context = new AudioContext({ latencyHint: "interactive" });
      master = context.createGain(); master.gain.value = Number(volume.value);
      master.connect(context.destination);
    }
    const audioContext = context;
    await audioContext.resume();
    const loaded = await loadAudio(audioContext);
    if (token !== generation) return;
    const startTime = audioContext.currentTime + 0.03;
    const gap = 0.55;
    const playNext = (index: number) => {
      if (token !== generation) return;
      cancelAnimationFrame(animation);
      if (index === ids.length) {
        source = undefined; stopButton.disabled = true; highlight(); progress.value = 0;
        status.textContent = "Comparison finished. Replay either clip to compare the character.";
        return;
      }
      const id = ids[index], buffer = loaded.get(id)!;
      const at = startTime + index * (duration + gap);
      const node = audioContext.createBufferSource(); node.buffer = buffer;
      const fade = audioContext.createGain(); voiceGain = fade;
      fade.gain.setValueAtTime(0, at); fade.gain.linearRampToValueAtTime(1, at + 0.004);
      fade.gain.setValueAtTime(1, at + buffer.duration - 0.004);
      fade.gain.linearRampToValueAtTime(0, at + buffer.duration);
      node.connect(fade).connect(master!); source = node;
      node.onended = () => { node.disconnect(); fade.disconnect(); playNext(index + 1); };
      node.start(at);
      const update = () => {
        if (token !== generation) return;
        const elapsed = audioContext.currentTime - at;
        const label = clips.find((clip) => clip.id === id)!.label;
        status.textContent = elapsed < 0 ? `Next: ${label}…` : `${index + 1}/${ids.length} · ${label}`;
        highlight(elapsed < 0 ? undefined : id);
        progress.max = buffer.duration; progress.value = Math.max(0, Math.min(buffer.duration, elapsed));
        if (elapsed < buffer.duration) animation = requestAnimationFrame(update);
      };
      update();
    };
    playNext(0);
  } catch (error) {
    if (token !== generation) return;
    stop(); status.textContent = error instanceof Error ? error.message : String(error);
  }
}

pair.addEventListener("click", () => { void play(["reference", "reconstruction"]); });
all.addEventListener("click", () => { void play(clips.map((clip) => clip.id)); });
for (const button of buttons) button.addEventListener("click", () => { void play([button.dataset.clip as ClipId]); });
stopButton.addEventListener("click", () => { stop(); status.textContent = "Stopped. Choose a clip to hear it again."; });
volume.addEventListener("input", () => {
  if (master && context) master.gain.setTargetAtTime(Number(volume.value), context.currentTime, 0.015);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stop(); status.textContent = "Playback stopped because the page is hidden."; }
});
window.addEventListener("pagehide", () => { stop(); if (context) void context.close(); });

async function init(): Promise<void> {
  try {
    const response = await fetch("/__audio-reference/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The local comparison has not been prepared on this server.");
    const manifest = await response.json();
    if (manifest.format !== "procgen-racing:tyre-reference-audition" || manifest.version !== 1 ||
      !Number.isFinite(manifest.durationSeconds) || manifest.durationSeconds < 0.1 || manifest.durationSeconds > 10)
      throw new Error("The prepared comparison is invalid.");
    duration = manifest.durationSeconds; ready = true;
    pair.disabled = all.disabled = false;
    for (const button of buttons) button.disabled = false;
    status.textContent = "Ready. Start with reference → reconstruction, then try frozen character.";
    element("reference-level").textContent = `Four ${duration.toFixed(2)}-second mono clips, matched in overall RMS level. Perceived loudness can still differ.`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
}
void init();
