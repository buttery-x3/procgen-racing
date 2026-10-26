/** Bounded authored audio inputs; non-finite telemetry never reaches AudioParams. */
export function clampAudio(value: number, minimum = 0, maximum = 1): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : minimum;
}

/**
 * Retarget on the audio clock. Do not set param.value here: it would destroy
 * previously scheduled transitions when an OfflineAudioContext is rendered.
 */
export function smoothParam(
  param: AudioParam,
  value: number,
  time: number,
  seconds = 0.02,
): void {
  if (!Number.isFinite(value) || !Number.isFinite(time)) return;
  param.cancelScheduledValues(Math.max(0, time));
  param.setTargetAtTime(value, Math.max(0, time), Math.max(0.001, seconds));
}

/**
 * Chromium 152 converts the default loop end from seconds back to frames.
 * A fractional residue above the buffer end can stop wrapping and reuse invalid
 * samples (crbug.com/553218226). Pick a nearby exact round trip, keeping rate 1.
 */
export function noiseBufferLength(sampleRate: number, durationSeconds: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new RangeError("Noise requires a finite positive sample rate and duration.");
  let frames = Math.ceil(sampleRate * durationSeconds);
  if (!Number.isSafeInteger(frames)) throw new RangeError("Noise buffer is too large.");
  while ((frames / sampleRate) * sampleRate !== frames) frames++;
  return frames;
}

/** Each voice gets its own deterministic, uncorrelated stream and loop length. */
export function createNoise(
  context: BaseAudioContext,
  seed: number,
  durationSeconds?: number,
): AudioBufferSourceNode {
  let state = (seed >>> 0) || 0x6d2b79f5;
  const duration = durationSeconds === undefined
    ? 2.03 + (state % 139) / 1000
    : clampAudio(durationSeconds, 0.1, 8);
  const buffer = context.createBuffer(
    1,
    noiseBufferLength(context.sampleRate, duration),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = ((state >>> 0) / 0x100000000) * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

/** Owners guard disposal; this helper also avoids duplicate disconnects. */
export function stopAndDisconnect(
  sources: readonly AudioScheduledSourceNode[],
  nodes: readonly AudioNode[],
): void {
  for (const source of new Set(sources)) {
    try {
      source.stop();
    } catch {
      // A closed context or a source that failed to start is already silent.
    }
  }
  for (const node of new Set<AudioNode>([...sources, ...nodes])) {
    try {
      node.disconnect();
    } catch {
      // Teardown remains safe after a context interruption/closure.
    }
  }
}
