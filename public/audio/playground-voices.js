// Accepted pulse/exhaust engine shared by driving and audition; older tyre comparisons remain here.
const bounded = (value, low = 0, high = 1) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low;

class SeededVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seed = 0x7284a3f1;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'reset') this.reset(data.seed);
      if (data?.type === 'control') this.target = data.value;
      if (data?.type === 'tuning') this.tuning = data.value;
      if (data?.type === 'dispose') this.disposed = true;
    };
  }

  random() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0x100000000;
  }

  reset(seed) { this.seed = (seed >>> 0) || 0x7284a3f1; }
}

class PulseExhaust extends SeededVoice {
  constructor() {
    super();
    this.target = { rpm: 900, load: 0.1, driveLoad: 0.1, overrun: 0, shifting: false };
    this.tuning = { body: 0.7, openness: 0.45, rasp: 0.36, unevenness: 0.38, mechanical: 0.25 };
    this.rpm = 900; this.load = 0.1; this.phase = 0; this.firing = 0; this.fireAmplitude = 1;
    this.dc = 0; this.low = 0; this.exhaustLow = 0; this.noiseLow = 0;
    this.delayA = new Float32Array(Math.max(4, Math.round(sampleRate * 0.0063)));
    this.delayB = new Float32Array(Math.max(4, Math.round(sampleRate * 0.0089)));
    this.indexA = 0; this.indexB = 0;
  }

  reset(seed) {
    super.reset(seed);
    this.phase = 0; this.firing = 0; this.fireAmplitude = 1;
    this.dc = 0; this.low = 0; this.exhaustLow = 0; this.noiseLow = 0;
    this.delayA?.fill(0); this.delayB?.fill(0);
    this.indexA = 0; this.indexB = 0;
  }

  process(_inputs, outputs) {
    if (this.disposed) return false;
    const out = outputs[0][0];
    if (!out) return true;
    const t = this.target || {};
    const p = this.tuning || {};
    const body = bounded(p.body), openness = bounded(p.openness), rasp = bounded(p.rasp);
    const uneven = bounded(p.unevenness), mechanical = bounded(p.mechanical);
    const rpmTarget = bounded(t.rpm, 250, 15000);
    const loadTarget = bounded(0.65 * bounded(t.load) + 0.35 * bounded(t.driveLoad));
    const rpmPole = Math.exp(-1 / (sampleRate * 0.027));
    const loadPole = Math.exp(-1 / (sampleRate * 0.06));
    const bodyPole = Math.exp(-2 * Math.PI * (110 + 170 * openness) / sampleRate);
    const exhaustPole = Math.exp(-2 * Math.PI * (450 + 2600 * openness) / sampleRate);
    const noisePole = Math.exp(-2 * Math.PI * 2600 / sampleRate);
    for (let i = 0; i < out.length; i++) {
      this.rpm = rpmTarget + rpmPole * (this.rpm - rpmTarget);
      this.load = loadTarget + loadPole * (this.load - loadTarget);
      const firingHz = this.rpm / 30; // Four evenly timed firings per 720-degree V8 cycle.
      this.phase += firingHz / sampleRate;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.firing++;
        const bank = this.firing % 2 ? 0.94 : 1.06;
        const cycle = this.firing % 4 === 0 ? 1.08 : 1;
        this.fireAmplitude = bank * cycle * (1 + uneven * (this.random() - 0.5) * 0.5);
      }
      // Raised pulse has no discontinuity at either edge, unlike a sawtooth.
      const width = 0.21;
      const pulse = this.phase < width ? Math.sin(Math.PI * this.phase / width) ** 2 * this.fireAmplitude : 0;
      this.dc += 0.001 * (pulse - this.dc);
      const excitation = pulse - this.dc;
      this.low = (1 - bodyPole) * excitation + bodyPole * this.low;
      const feedbackA = this.delayA[this.indexA];
      const feedbackB = this.delayB[this.indexB];
      // Two short, bounded exhaust paths smear the impulses into a low rumble.
      this.delayA[this.indexA] = excitation + feedbackA * 0.47;
      this.delayB[this.indexB] = excitation - feedbackB * 0.39;
      this.indexA = (this.indexA + 1) % this.delayA.length;
      this.indexB = (this.indexB + 1) % this.delayB.length;
      const exhaust = (feedbackA + feedbackB) * 0.5;
      this.exhaustLow = (1 - exhaustPole) * exhaust + exhaustPole * this.exhaustLow;
      const noise = (this.random() * 2 - 1) * (0.15 + this.load * 0.85);
      this.noiseLow = (1 - noisePole) * noise + noisePole * this.noiseLow;
      const shift = t.shifting ? 0.42 : 1;
      const chest = this.low * (0.28 + body * 0.54);
      const pipe = this.exhaustLow * (0.26 + this.load * 0.5) * shift;
      const bite = (exhaust - this.exhaustLow) * rasp * this.load * 0.33 * shift;
      const machinery = (noise - this.noiseLow) * mechanical * 0.045;
      const overrun = bounded(t.overrun) * (exhaust - this.exhaustLow) * 0.09;
      out[i] = bounded((chest + pipe + bite + machinery + overrun) * 0.18, -0.9, 0.9);
    }
    return true;
  }
}

class FrictionTyre extends SeededVoice {
  constructor() {
    super();
    this.target = { warning: 0, slip: 0, rolling: 0, load: 1, speed: 0, slipSpeed: 0, grounded: true };
    this.tuning = { scrape: 0.7, screech: 0.5, roughness: 0.55, brightness: 0.55, onset: 0.45, release: 0.5 };
    this.activity = 0; this.noiseLow = 0; this.surfaceLow = 0; this.flutter = 0; this.flutterCount = 0;
    this.filters = Array.from({ length: 4 }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
  }

  reset(seed) {
    super.reset(seed);
    this.activity = 0; this.noiseLow = 0; this.surfaceLow = 0; this.flutter = 0; this.flutterCount = 0;
    for (const f of this.filters || []) f.x1 = f.x2 = f.y1 = f.y2 = 0;
  }

  process(_inputs, outputs) {
    const tyre = outputs[0][0], surface = outputs[1][0];
    if (!tyre || !surface) return true;
    const t = this.target || {}, p = this.tuning || {};
    const scrape = bounded(p.scrape), screech = bounded(p.screech), roughness = bounded(p.roughness);
    const brightness = bounded(p.brightness), onset = bounded(p.onset), release = bounded(p.release);
    const contact = !!t.grounded && bounded(t.load) > 0.001 && (bounded(t.speed, 0, 150) > 0.2 || bounded(t.slipSpeed, 0, 150) > 0.15);
    const slip = contact ? bounded(t.slip) : 0, warning = contact ? bounded(t.warning) : 0;
    const sliding = bounded(t.slipSpeed, 0, 50) / 50;
    const target = Math.min(1, warning * 0.3 + slip * (0.7 + sliding * 0.3));
    const seconds = target > this.activity ? 0.012 + onset * 0.15 : 0.025 + release * 0.45;
    const pole = Math.exp(-1 / (sampleRate * seconds));
    const noisePole = Math.exp(-2 * Math.PI * (450 + brightness * 2100) / sampleRate);
    const surfacePole = Math.exp(-2 * Math.PI * 310 / sampleRate);
    const modes = [540, 970, 1610, 2570];
    const weights = [0.35, 0.46, 0.35, 0.21];
    const coefficients = modes.map((base, index) => {
      // Broad, unequal noise-excited modes. No coherent sine or common vibrato.
      const center = Math.min(sampleRate * 0.42, base * (0.85 + brightness * 0.32) * (1 + sliding * (index % 2 ? -0.06 : 0.08)));
      const q = 1.2 + screech * 2.1 + index * 0.13;
      const w = 2 * Math.PI * center / sampleRate, alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      return { b0: alpha / a0, b2: -alpha / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - alpha) / a0 };
    });
    for (let i = 0; i < tyre.length; i++) {
      this.activity = target + pole * (this.activity - target);
      if (++this.flutterCount > sampleRate * 0.014) {
        this.flutterCount = 0;
        this.flutter = (this.random() - 0.5) * roughness;
      }
      const noise = this.random() * 2 - 1;
      this.noiseLow = (1 - noisePole) * noise + noisePole * this.noiseLow;
      const broadband = noise - this.noiseLow * 0.7;
      let modal = 0;
      for (let j = 0; j < this.filters.length; j++) {
        const f = this.filters[j], c = coefficients[j];
        const y = c.b0 * noise + c.b2 * f.x2 - c.a1 * f.y1 - c.a2 * f.y2;
        f.x2 = f.x1; f.x1 = noise; f.y2 = f.y1; f.y1 = y;
        modal += y * weights[j];
      }
      const texture = 1 + this.flutter * 0.5;
      const level = this.activity * (0.5 + 0.5 * slip);
      tyre[i] = bounded((broadband * (0.32 + scrape * 0.5) + modal * screech * 0.9) * texture * level * 0.05, -0.9, 0.9);
      this.surfaceLow = (1 - surfacePole) * noise + surfacePole * this.surfaceLow;
      surface[i] = bounded(this.surfaceLow * bounded(t.rolling) * 0.02, -0.2, 0.2);
    }
    return true;
  }
}

// Second audition candidate. A coherent squeal carries the slide; scrape is optional.
// Keep FrictionTyre registered so first-generation saved presets keep their sound.
class TonalTyre extends SeededVoice {
  constructor() {
    super();
    this.target = { id: 'fl', warning: 0, slip: 0, rolling: 0, load: 1, speed: 0, slipSpeed: 0, grounded: true };
    this.tuning = { tone: 0.74, edge: 0.7, pitch: 0.47, roughness: 0.64, scrape: 0, onset: 0.22, release: 0.36 };
    this.phase = 0; this.activity = 0; this.flutter = 0; this.flutterTarget = 0;
    this.flutterCount = 0; this.wander = 0; this.scrapeLow = 0; this.surfaceLow = 0;
    this.tone = this.tuning.tone; this.edge = this.tuning.edge;
    this.pitch = this.tuning.pitch; this.scrape = this.tuning.scrape;
  }

  reset(seed) {
    super.reset(seed);
    this.phase = 0; this.activity = 0; this.flutter = 0; this.flutterTarget = 0;
    this.flutterCount = 0; this.wander = 0; this.scrapeLow = 0; this.surfaceLow = 0;
  }

  process(_inputs, outputs) {
    const tyre = outputs[0][0], surface = outputs[1][0];
    if (!tyre || !surface) return true;
    const t = this.target || {}, p = this.tuning || {};
    const tone = bounded(p.tone), edge = bounded(p.edge), pitch = bounded(p.pitch);
    const roughness = bounded(p.roughness), scrape = bounded(p.scrape);
    const onset = bounded(p.onset), release = bounded(p.release);
    const contact = !!t.grounded && bounded(t.load) > 0.001 &&
      (bounded(t.speed, 0, 150) > 0.2 || bounded(t.slipSpeed, 0, 150) > 0.15);
    const slip = contact ? bounded(t.slip) : 0, warning = contact ? bounded(t.warning) : 0;
    const sliding = bounded(t.slipSpeed, 0, 50) / 50;
    const target = Math.min(1, warning * 0.3 + slip * (0.7 + sliding * 0.3));
    const seconds = target > this.activity ? 0.012 + onset * 0.15 : 0.025 + release * 0.45;
    const activityPole = Math.exp(-1 / (sampleRate * seconds));
    const tuningPole = Math.exp(-1 / (sampleRate * 0.014));
    const flutterPole = Math.exp(-1 / (sampleRate * 0.0025));
    const wanderPole = Math.exp(-1 / (sampleRate * 0.03));
    const scrapePole = Math.exp(-2 * Math.PI * 850 / sampleRate);
    const surfacePole = Math.exp(-2 * Math.PI * 310 / sampleRate);
    const axle = t.id === 'rl' || t.id === 'rr' ? 0.86 : 1;
    for (let i = 0; i < tyre.length; i++) {
      this.activity = target + activityPole * (this.activity - target);
      this.tone = tone + tuningPole * (this.tone - tone);
      this.edge = edge + tuningPole * (this.edge - edge);
      this.pitch = pitch + tuningPole * (this.pitch - pitch);
      this.scrape = scrape + tuningPole * (this.scrape - scrape);
      if (--this.flutterCount <= 0) {
        this.flutterCount = Math.max(1, Math.round(sampleRate * (0.009 + this.random() * 0.015)));
        this.flutterTarget = this.random() * 2 - 1;
      }
      this.flutter = this.flutterTarget + flutterPole * (this.flutter - this.flutterTarget);
      this.wander = this.flutter + wanderPole * (this.wander - this.flutter);
      const baseHz = (1470 + 690 * this.pitch) * axle;
      const frequency = Math.min(sampleRate * 0.42 / 5, baseHz *
        (1 + roughness * (this.wander * 0.012 + this.flutter * 0.003) + sliding * 0.006));
      this.phase += frequency / sampleRate;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      const a = 2 * Math.PI * this.phase;
      // Fixed harmonic phases yield a continuous, band-limited squeal with an
      // adjustable ragged edge. Slip changes energy/texture, not musical pitch.
      const body = Math.sin(a) * 0.62;
      const bite = Math.sin(2 * a + 0.48) * (0.12 + this.edge * 0.27) +
        Math.sin(3 * a + 1.3) * (0.06 + this.edge * 0.24) +
        Math.sin(4 * a + 2.1) * (0.025 + this.edge * 0.15) +
        Math.sin(5 * a + 2.9) * (0.015 + this.edge * 0.09);
      const noise = this.random() * 2 - 1;
      this.scrapeLow = (1 - scrapePole) * noise + scrapePole * this.scrapeLow;
      const highNoise = noise - this.scrapeLow;
      const texture = 1 + roughness * this.flutter * 0.37;
      const level = this.activity * (0.15 + 0.85 * slip) * texture;
      tyre[i] = bounded(((body + bite) * this.tone * 0.05 + highNoise * this.scrape * 0.009) * level, -0.9, 0.9);
      this.surfaceLow = (1 - surfacePole) * noise + surfacePole * this.surfaceLow;
      surface[i] = bounded(this.surfaceLow * bounded(t.rolling) * 0.02, -0.2, 0.2);
    }
    return true;
  }
}

registerProcessor('playground-pulse-exhaust', PulseExhaust);
registerProcessor('playground-friction-tyre', FrictionTyre);
registerProcessor('playground-tonal-tyre', TonalTyre);
