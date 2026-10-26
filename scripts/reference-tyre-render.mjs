import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/audio/reference-tyre.js", import.meta.url), "utf8");
const script = new vm.Script(source);

/** Host render of the exact worklet source; excludes browser/device rendering. */
export function referenceTyreRenderer(model, rate = 48000, tuning = {}, seed = 0x51a3d207) {
  const messages = [], registrations = new Map();
  class BaseProcessor { port = { onmessage: undefined, postMessage: (message) => { messages.push(message); } }; }
  script.runInNewContext({ AudioWorkletProcessor: BaseProcessor, sampleRate: rate,
    registerProcessor: (name, type) => registrations.set(name, type), Math, Number, Float32Array, Float64Array, Uint16Array });
  const Processor = registrations.get("playground-reference-tyre");
  const processor = new Processor();
  const send = (type, value) => processor.port.onmessage({ data: { type, value } });
  send("profile", model);
  if (messages.at(-1)?.type !== "profile-ready") throw new Error("Profile failed to load");
  processor.port.onmessage({ data: { type: "reset", seed } });
  send("tuning", { character: .5, texture: .5, pitch: .5, movement: .65, onset: .22, release: .36, ...tuning });
  const tyre = new Float32Array(128), surface = new Float32Array(128);
  return { processor, messages, send, block(control) {
    if (control) send("control", control);
    processor.process([], [[tyre], [surface]]);
    return tyre;
  } };
}

export function renderReferenceTyre(model, rate, duration, controls, tuning) {
  const renderer = referenceTyreRenderer(model, rate, tuning);
  const pcm = new Float32Array(Math.round(duration * rate));
  for (let offset = 0; offset < pcm.length; offset += 128) {
    const block = renderer.block(controls(offset / rate));
    pcm.set(block.subarray(0, Math.min(128, pcm.length - offset)), offset);
  }
  return { pcm, messages: renderer.messages };
}
