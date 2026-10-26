// Playground only. The locally prepared spectral model is never bundled here.
const clamp = (n, lo = 0, hi = 1) => Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
const mix = (a, b, t) => a + (b - a) * t;

class SpectralFFT {
  constructor(size) {
    this.size = size;
    this.real = new Float64Array(size); this.imag = new Float64Array(size);
    this.reverse = new Uint16Array(size);
    this.cos = new Float64Array(size / 2); this.sin = new Float64Array(size / 2);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let value = i, reversed = 0;
      for (let b = 0; b < bits; b++) { reversed = reversed * 2 + (value & 1); value >>>= 1; }
      this.reverse[i] = reversed;
    }
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / size); this.sin[i] = Math.sin(2 * Math.PI * i / size);
    }
  }
  transform(inverse = false) {
    const n = this.size, r = this.real, im = this.imag;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) { const a = r[i], b = im[i]; r[i] = r[j]; im[i] = im[j]; r[j] = a; im[j] = b; }
    }
    for (let width = 2; width <= n; width *= 2) {
      const half = width / 2, stride = n / width;
      for (let base = 0; base < n; base += width) for (let j = 0; j < half; j++) {
        const k = j * stride, c = this.cos[k], s = this.sin[k] * (inverse ? 1 : -1);
        const a = base + j, b = a + half;
        const re = r[b] * c - im[b] * s, ii = r[b] * s + im[b] * c;
        r[b] = r[a] - re; im[b] = im[a] - ii; r[a] += re; im[a] += ii;
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { r[i] /= n; im[i] /= n; }
  }
}

class ReferenceTyre extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fft = new SpectralFFT(2048);
    this.ring = new Float64Array(4096); this.window = new Float64Array(2048);
    for (let i = 0; i < 2048; i++) this.window[i] = Math.sqrt(.5 - .5 * Math.cos(2 * Math.PI * i / 2048));
    this.target = {}; this.tuning = { character: .5, texture: .5, pitch: .5, movement: .65, onset: .22, release: .36 };
    this.reset(0x51a3d207);
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'reset') this.reset(data.seed);
      if (data?.type === 'control') this.target = data.value || {};
      if (data?.type === 'tuning') this.tuning = data.value || {};
      if (data?.type === 'profile') {
        try { this.loadProfile(data.value); this.port.postMessage({ type: 'profile-ready' }); }
        catch { this.port.postMessage({ type: 'profile-error', message: 'Invalid local tyre control model' }); }
      }
    };
  }

  reset(seed) {
    this.seed = (seed >>> 0) || 0x51a3d207;
    this.level = 0; this.stress = 0; this.previous = 0; this.open = false;
    this.age = 0; this.recovery = 0; this.position = .07; this.state = 'quiet';
    this.wander = 0; this.wanderTarget = 0; this.wanderTime = 0;
    this.pitch = 1; this.texture = 1; this.surfaceLow = 0;
    this.cursor = 0; this.grainCountdown = 0; this.reportFrames = 0; this.elapsedFrames = 0;
    this.ring?.fill(0); this.phase?.fill(0); this.amplitude?.fill(0); this.ampTarget?.fill(0); this.frequency?.fill(0); this.ids?.fill(0);
  }

  random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0x100000000;
  }

  loadProfile(p) {
    if (p?.format !== 'procgen-racing:tyre-control-model' || p.version !== 1 ||
        typeof p.id !== 'string' || !p.id.startsWith('local:tyre-spectrum-v1:') ||
        !Number.isInteger(p.frames) || p.frames < 3 || p.frames > 512 ||
        !Number.isInteger(p.slots) || p.slots < 1 || p.slots > 32 ||
        !Number.isInteger(p.noiseBins) || p.noiseBins < 3 || p.noiseBins > 512 ||
        !Number.isFinite(p.frequencyStepHz) || p.frequencyStepHz < 10 || p.frequencyStepHz > 100 ||
        p.partials?.length !== p.frames * p.slots * 3 || p.residual?.length !== p.frames * p.noiseBins ||
        !Array.isArray(p.initialPhases) || p.initialPhases.length < 2 || p.initialPhases.length > 2048)
      throw new Error('Invalid profile dimensions');
    for (let i = 0; i < p.partials.length; i += 3) {
      if (!Number.isInteger(p.partials[i]) || p.partials[i] < 0 || p.partials[i] >= p.initialPhases.length ||
          !Number.isFinite(p.partials[i + 1]) || p.partials[i + 1] < 0 || p.partials[i + 1] > 8000 ||
          !Number.isFinite(p.partials[i + 2]) || p.partials[i + 2] < 0 || p.partials[i + 2] > 2)
        throw new Error('Invalid partial');
    }
    if (!p.residual.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
        !p.initialPhases.every(n => Number.isFinite(n))) throw new Error('Invalid spectral data');
    this.model = { ...p, partials: Float32Array.from(p.partials), residual: Float32Array.from(p.residual) };
    this.phase = new Float64Array(p.slots); this.amplitude = new Float64Array(p.slots);
    this.ampTarget = new Float64Array(p.slots); this.hzTarget = new Float64Array(p.slots);
    this.frequency = new Float64Array(p.slots); this.ids = new Uint16Array(p.slots);
    this.reset(this.seed);
  }

  updateState(dt) {
    const t = this.target, p = this.tuning;
    const contact = !!t.grounded && clamp(t.load) > .001 &&
      (clamp(t.speed, 0, 150) > .2 || clamp(t.slipSpeed, 0, 150) > .15);
    const excitation = contact ? clamp(clamp(t.slip) * .88 + clamp(t.warning) * .12) : 0;
    const wasOpen = this.open;
    this.open = contact && excitation > (this.open ? .025 : .06);
    if (this.open && !wasOpen) {
      this.age = 0; this.recovery = 0;
      if (this.level < .01) this.position = .07;
    }
    this.age += dt;
    // Compare with recent excitation, not a per-message delta: the state must
    // behave the same under audio-block and animation-frame control updates.
    if (excitation < this.stress - .012) this.recovery = .35;
    else if (excitation > this.stress + .012) this.recovery = 0;
    else this.recovery = Math.max(0, this.recovery - dt);
    this.stress += (excitation - this.stress) * (1 - Math.exp(-dt / .16));
    this.state = !this.open ? (this.level > .002 ? 'recovering' : 'quiet')
      : this.recovery > 0 ? 'recovering' : this.age < .65 ? 'entering' : 'sliding';
    this.wanderTime -= dt;
    if (this.wanderTime <= 0) { this.wanderTime = .25 + this.random() * .4; this.wanderTarget = this.random() * 2 - 1; }
    this.wander += (this.wanderTarget - this.wander) * (1 - Math.exp(-dt / .3));
    const movement = clamp(p.movement), offset = (clamp(p.character) - .5) * .16;
    const sustained = .38 + this.stress * .25 + this.wander * .12 * movement + offset;
    const goal = this.state === 'quiet' ? .07 : this.state === 'recovering' ? .9 + offset * .25
      : this.state === 'entering' ? mix(.07, sustained, clamp(this.age / .65)) : sustained;
    this.position += (clamp(goal, .05, .94) - this.position) * (1 - Math.exp(-dt / .12));
    const target = this.open ? excitation * Math.sqrt(clamp(t.load)) : 0;
    const seconds = !contact ? .007 : target > this.level ? .012 + clamp(p.onset) * .15 : .025 + clamp(p.release) * .45;
    const next = target + (this.level - target) * Math.exp(-dt / seconds);
    const levelStep = (next - this.level) / (dt * sampleRate);
    const pitch = 2 ** ((clamp(p.pitch) - .5) * .4) * ((t.id === 'rl' || t.id === 'rr') ? .94 : 1);
    this.pitch += (pitch - this.pitch) * (1 - Math.exp(-dt / .04));
    this.texture += (2 ** ((clamp(p.texture) - .5) * 2) - this.texture) * (1 - Math.exp(-dt / .03));
    return levelStep;
  }

  spectralNoise(frame, fraction) {
    const fft = this.fft, model = this.model, n = fft.size;
    for (let i = 0; i < n; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(Math.max(1e-9, this.random()))), angle = 2 * Math.PI * this.random();
      fft.real[i] = radius * Math.cos(angle); fft.real[i + 1] = radius * Math.sin(angle);
    }
    fft.imag.fill(0); fft.transform();
    const bins = model.noiseBins, a = frame * bins, b = (frame + 1) * bins;
    const whiteMagnitude = Math.sqrt(1.5 / n);
    const densityScale = Math.sqrt(sampleRate / (n * model.frequencyStepHz * this.pitch));
    for (let k = 0; k <= n / 2; k++) {
      const index = k * sampleRate / n / this.pitch / model.frequencyStepHz;
      const left = Math.floor(index), u = index - left;
      let magnitude = 0;
      if (left >= 0 && left + 1 < bins) {
        magnitude = mix(mix(model.residual[a + left], model.residual[a + left + 1], u),
          mix(model.residual[b + left], model.residual[b + left + 1], u), fraction);
      }
      const gain = magnitude / whiteMagnitude * densityScale;
      fft.real[k] *= gain; fft.imag[k] *= gain;
      if (k > 0 && k < n / 2) { fft.real[n - k] *= gain; fft.imag[n - k] *= gain; }
    }
    fft.transform(true);
    for (let i = 0; i < n; i++) this.ring[(this.cursor + i) & 4095] += fft.real[i] * this.window[i];
  }

  process(_inputs, outputs) {
    const tyre = outputs[0]?.[0], surface = outputs[1]?.[0];
    if (!tyre || !surface) return true;
    if (!this.model) { tyre.fill(0); surface.fill(0); return true; }
    const dt = tyre.length / sampleRate, step = this.updateState(dt), model = this.model;
    const at = clamp(this.position, .05, .94) * (model.frames - 1), frame = Math.floor(at), fraction = at - frame;
    const left = frame * model.slots * 3, right = (frame + 1) * model.slots * 3;
    for (let voice = 0; voice < model.slots; voice++) {
      const a = left + voice * 3, b = right + voice * 3;
      const same = model.partials[a] === model.partials[b];
      const selected = same || fraction < .5 ? a : b;
      const id = model.partials[selected];
      if (id !== this.ids[voice]) {
        if (this.amplitude[voice] < .0001) this.phase[voice] = model.initialPhases[id];
        this.ids[voice] = id;
      }
      this.hzTarget[voice] = (same ? mix(model.partials[a + 1], model.partials[b + 1], fraction) : model.partials[selected + 1]) * this.pitch;
      // Profiles have zero amplitude at track births/deaths. Nonmatching IDs
      // cross silence rather than interpolating between unrelated frequencies.
      this.ampTarget[voice] = same ? mix(model.partials[a + 2], model.partials[b + 2], fraction)
        : model.partials[selected + 2] * (selected === a ? 1 - fraction : fraction);
    }
    const surfacePole = Math.exp(-2 * Math.PI * 310 / sampleRate), rolling = clamp(this.target.rolling);
    const amplitudeStep = 1 - Math.exp(-1 / (sampleRate * .003)), frequencyStep = 1 - Math.exp(-1 / (sampleRate * .001));
    for (let i = 0; i < tyre.length; i++) {
      if (--this.grainCountdown <= 0) {
        this.spectralNoise(frame, fraction); this.grainCountdown = 1024;
      }
      let tonal = 0;
      for (let voice = 0; voice < model.slots; voice++) {
        this.amplitude[voice] += (this.ampTarget[voice] - this.amplitude[voice]) * amplitudeStep;
        this.frequency[voice] += (this.hzTarget[voice] - this.frequency[voice]) * frequencyStep;
        this.phase[voice] += 2 * Math.PI * this.frequency[voice] / sampleRate;
        if (this.phase[voice] > 2 * Math.PI) this.phase[voice] -= 2 * Math.PI;
        tonal += Math.cos(this.phase[voice]) * this.amplitude[voice];
      }
      const noise = this.ring[this.cursor]; this.ring[this.cursor] = 0; this.cursor = (this.cursor + 1) & 4095;
      this.level = clamp(this.level + step);
      tyre[i] = clamp((tonal + noise * this.texture) * this.level, -.9, .9);
      this.surfaceLow = (1 - surfacePole) * (this.random() * 2 - 1) + surfacePole * this.surfaceLow;
      surface[i] = this.surfaceLow * rolling * .02;
    }
    this.reportFrames += tyre.length;
    this.elapsedFrames += tyre.length;
    if (this.reportFrames >= sampleRate * .1) {
      this.reportFrames = 0;
      this.port.postMessage({ type: 'state', state: this.state, position: this.position, level: this.level, seconds: this.elapsedFrames / sampleRate });
    }
    return true;
  }
}

registerProcessor('playground-reference-tyre', ReferenceTyre);
