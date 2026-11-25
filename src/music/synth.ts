import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import {
  clamp,
  createRng,
  midiToHz,
  type DrumHit,
  type PieceScore,
  type VoiceId,
} from "./types.ts";

export { SAMPLE_RATE, SAMPLES_PER_FRAME };

const TWO_PI = Math.PI * 2;
const WAVETABLE_SIZE = 4096;
const WAVETABLE_MASK = WAVETABLE_SIZE - 1;

/** Precomputed single-cycle harmonic wavetables (zero-DC, normalized) */
function buildHarmonicTable(
  amplitudes: readonly number[],
  phases?: readonly number[],
): Float32Array {
  const table = new Float32Array(WAVETABLE_SIZE);
  let maxAbs = 1e-6;
  for (let i = 0; i < WAVETABLE_SIZE; i++) {
    const theta = (TWO_PI * i) / WAVETABLE_SIZE;
    let sum = 0;
    for (let k = 0; k < amplitudes.length; k++) {
      const amp = amplitudes[k];
      if (amp === 0) continue;
      const phi = phases ? phases[k] ?? 0 : 0;
      sum += amp * Math.sin((k + 1) * theta + phi);
    }
    table[i] = sum;
    if (Math.abs(sum) > maxAbs) maxAbs = Math.abs(sum);
  }
  for (let i = 0; i < WAVETABLE_SIZE; i++) {
    table[i] /= maxAbs;
  }
  return table;
}

// Tar bright bridge-plucked transient table (pickPos ~ 0.13) & warm sustain table
const TAR_BRIGHT_TABLE = buildHarmonicTable(
  Array.from({ length: 14 }, (_, idx) => {
    const k = idx + 1;
    if (k === 1) return 1.45;
    return (Math.abs(Math.sin(Math.PI * k * 0.13)) + 0.18) / Math.pow(k, 1.15);
  }),
);
const TAR_WARM_TABLE = buildHarmonicTable([1.0, 0.38, 0.2, 0.09, 0.04, 0.02]);

// Kamancha bowed spike-fiddle table with nasal wooden bowl formant weighting
const KAMANCHA_TABLE = buildHarmonicTable([
  1.0, 0.62, 0.48, 0.34, 0.25, 0.18, 0.13, 0.09, 0.06, 0.04, 0.025, 0.015,
]);

// Orchestral lead & brass tables
const LEAD_SOFT_TABLE = buildHarmonicTable([1.0, 0.32, 0.52, 0.18, 0.22, 0.08, 0.09]);
const LEAD_BRIGHT_TABLE = buildHarmonicTable([
  1.0, 0.68, 0.52, 0.38, 0.28, 0.2, 0.14, 0.1, 0.07, 0.04,
]);
const BRASS_WARM_TABLE = buildHarmonicTable([1.0, 0.55, 0.35, 0.2, 0.1, 0.05]);
const BRASS_BLAZE_TABLE = buildHarmonicTable([
  1.0, 0.88, 0.74, 0.6, 0.46, 0.35, 0.26, 0.19, 0.13, 0.09, 0.06, 0.04,
]);

// Bass & ensemble tables (fundamental strictly dominant for clear pitch & phone translation)
const BASS_TABLE = buildHarmonicTable([1.0, 0.44, 0.22, 0.09, 0.04]);
const HARMONY_TABLE = buildHarmonicTable([1.0, 0.45, 0.28, 0.15, 0.08, 0.04]);

function sampleTable(table: Float32Array, phase01: number): number {
  const p = phase01 - Math.floor(phase01);
  const pos = p * WAVETABLE_SIZE;
  const idx = pos | 0;
  const frac = pos - idx;
  const a = table[idx & WAVETABLE_MASK];
  const b = table[(idx + 1) & WAVETABLE_MASK];
  return a + (b - a) * frac;
}

/**
 * Generates a fractional-delay Karplus-Strong plucked waveguide buffer
 * tuned to `freqHz` (compensating 0.5-sample averaging filter delay).
 */
function renderKarplusStrong(
  freqHz: number,
  sampleCount: number,
  damping: number,
  brightness: number,
  seed: number,
): Float32Array {
  const out = new Float32Array(sampleCount);
  // Exact group delay of 2-tap loop filter (wA * y[0] + wB * y[-1]) is wB = 0.5 - 0.35 * brightness
  const filterDelay = 0.5 - 0.35 * brightness;
  const exactDelay = Math.max(4, SAMPLE_RATE / freqHz - filterDelay);
  const bufLen = Math.ceil(exactDelay) + 4;
  const delayLine = new Float32Array(bufLen);
  const rng = createRng(seed);

  // Fill initial waveguide with zero-mean smoothed pick burst
  const initLen = Math.max(4, Math.round(exactDelay));
  let mean = 0;
  for (let i = 0; i < initLen; i++) {
    const window = Math.sin((Math.PI * (i + 0.5)) / initLen);
    const v = (rng() * 2 - 1) * (0.65 + 0.35 * window);
    delayLine[i] = v;
    mean += v;
  }
  mean /= initLen;
  for (let i = 0; i < initLen; i++) {
    delayLine[i] -= mean;
  }
  // Optional 1-pass pre-smoothing for warmer gut-string tone when brightness < 0.7
  if (brightness < 0.85) {
    const alpha = clamp(brightness, 0.15, 0.85);
    let prev = delayLine[initLen - 1];
    for (let i = 0; i < initLen; i++) {
      const cur = delayLine[i];
      delayLine[i] = prev + alpha * (cur - prev);
      prev = delayLine[i];
    }
  }

  let writeIdx = 0;
  const dInt = Math.floor(exactDelay);
  const dFrac = exactDelay - dInt;

  for (let n = 0; n < sampleCount; n++) {
    const r0 = (writeIdx - dInt + bufLen * 2) % bufLen;
    const r1 = (r0 - 1 + bufLen) % bufLen;
    const r2 = (r1 - 1 + bufLen) % bufLen;
    // Linear fractional read between delay dInt and dInt+1
    const delayedA = delayLine[r0] * (1 - dFrac) + delayLine[r1] * dFrac;
    const delayedB = delayLine[r1] * (1 - dFrac) + delayLine[r2] * dFrac;
    // Two-point lowpass loop filter controlled by brightness
    const filtered = delayedA * (0.5 + 0.35 * brightness) + delayedB * (0.5 - 0.35 * brightness);
    const nextVal = filtered * damping;
    delayLine[writeIdx] = nextVal;
    out[n] = nextVal;
    writeIdx = (writeIdx + 1) % bufLen;
  }
  return out;
}

function defaultVoicePan(voice: VoiceId, midi: number): number {
  const pitchOffset = clamp((midi - 64) / 36, -0.35, 0.35);
  switch (voice) {
    case "tar":
      return -0.14 + pitchOffset * 0.45;
    case "kamancha":
      return 0.16 + pitchOffset * 0.35;
    case "bass":
      return pitchOffset * 0.15;
    case "pizzicato":
      return pitchOffset * 0.5;
    case "harmony":
    case "arp":
      return -pitchOffset * 0.55;
    default:
      return pitchOffset * 0.45;
  }
}

function addPannedSample(
  dryL: Float32Array,
  dryR: Float32Array,
  revSendL: Float32Array,
  revSendR: Float32Array,
  totalSamples: number,
  idx: number,
  sampleL: number,
  sampleR: number,
  reverbSend: number,
): void {
  const wrapped = ((idx % totalSamples) + totalSamples) % totalSamples;
  dryL[wrapped] += sampleL;
  dryR[wrapped] += sampleR;
  if (reverbSend > 0) {
    revSendL[wrapped] += sampleL * reverbSend;
    revSendR[wrapped] += sampleR * reverbSend;
  }
}

function renderVoiceIntoMix(
  dryL: Float32Array,
  dryR: Float32Array,
  revSendL: Float32Array,
  revSendR: Float32Array,
  totalSamples: number,
  startSample: number,
  durationSec: number,
  midi: number,
  velocity: number,
  voice: VoiceId,
  panOverride: number | undefined,
  noteIdx: number,
): void {
  const f0 = midiToHz(midi);
  // Avoid aliasing on super-high harmonics by slightly taming brightness above C6
  const highRoll = clamp(1.25 - f0 / 2200, 0.35, 1.0);
  const pan = clamp(panOverride ?? defaultVoicePan(voice, midi), -0.85, 0.85);
  const angle = ((pan + 1) * Math.PI) / 4;
  const gainL = Math.cos(angle);
  const gainR = Math.sin(angle);
  const velGain = Math.pow(clamp(velocity, 0.05, 1.0), 1.15);

  // Determine acoustic ring-out length so plucks/bells ring naturally without abrupt cuts
  let renderDur = durationSec;
  if (voice === "tar" || voice === "arp") {
    renderDur = Math.max(durationSec * 1.15, Math.min(0.85, durationSec + 0.32));
  } else if (voice === "chime" || voice === "bell") {
    renderDur = Math.max(durationSec * 1.25, Math.min(1.45, durationSec + 0.65));
  } else if (voice === "pizzicato") {
    renderDur = Math.min(0.48, Math.max(0.18, durationSec * 1.1));
  } else {
    renderDur = durationSec + 0.045;
  }

  const count = Math.max(64, Math.round(renderDur * SAMPLE_RATE));
  const fadeOutSamples = Math.min(
    Math.floor(count * 0.35),
    Math.max(96, Math.round(0.018 * SAMPLE_RATE)),
  );

  // Pre-compute Karplus-Strong waveguide when voice uses plucked string synthesis
  let ksBuf: Float32Array | null = null;
  if (voice === "tar" || voice === "arp" || voice === "pizzicato") {
    const damping =
      voice === "pizzicato" ? 0.986 : voice === "arp" ? 0.9945 : 0.9935;
    const bright = voice === "pizzicato" ? 0.48 : 0.82 * highRoll;
    ksBuf = renderKarplusStrong(
      f0,
      count,
      damping,
      bright,
      ((noteIdx + 1) * 2654435761 + midi * 97) >>> 0,
    );
  }

  let phaseMain = 0;
  let phaseDetuneA = 0.0;
  let phaseDetuneB = 0.08;
  const dPhase = f0 / SAMPLE_RATE;

  const revAmount =
    voice === "kamancha" || voice === "bell" || voice === "chime"
      ? 0.28
      : voice === "bass" || voice === "pizzicato"
        ? 0.1
        : 0.19;

  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const rem = count - 1 - i;
    const declickTail = rem < fadeOutSamples ? rem / fadeOutSamples : 1;

    let sigL = 0;
    let sigR = 0;

    if (voice === "tar") {
      // Plucked Azerbaijani Tar: crisp mizrab attack + KS waveguide + double-course modal body
      const attack = Math.min(1, i / (0.0024 * SAMPLE_RATE));
      const brightEnv = Math.exp(-t * 14.5) * highRoll;
      const warmEnv = Math.exp(-t * 3.4);
      const courseA =
        sampleTable(TAR_BRIGHT_TABLE, phaseDetuneA) * brightEnv * 0.52 +
        sampleTable(TAR_WARM_TABLE, phaseMain) * warmEnv * 0.68;
      const courseB =
        sampleTable(TAR_BRIGHT_TABLE, phaseDetuneB) * brightEnv * 0.52 +
        sampleTable(TAR_WARM_TABLE, phaseDetuneB) * warmEnv * 0.42;
      const ks = (ksBuf ? ksBuf[i] : 0) * Math.exp(-t * 4.5) * 0.42;
      // Subtle sympathetic octave course shimmer
      const oct = Math.sin(TWO_PI * phaseMain * 2) * Math.exp(-t * 7.5) * 0.065;
      const amp = 0.34 * velGain * attack * declickTail;
      sigL = (courseA * 0.7 + courseB * 0.3 + ks + oct) * amp;
      sigR = (courseA * 0.3 + courseB * 0.7 + ks * 0.92 + oct) * amp;
      phaseMain += dPhase;
      phaseDetuneA += dPhase * 1.0008; // +1.4 cents
      phaseDetuneB += dPhase * 0.9992; // -1.4 cents
    } else if (voice === "kamancha") {
      // Bowed Azerbaijani Kamancha: smooth bow-catch S-curve + delayed singing mugham vibrato
      const attackSec = Math.min(0.052, Math.max(0.018, durationSec * 0.22));
      const u = clamp(t / attackSec, 0, 1);
      const bowAttack = u * u * (3 - 2 * u);
      const releaseStart = Math.max(attackSec, durationSec - 0.025);
      const noteSustain =
        t < releaseStart
          ? 1 - 0.08 * clamp((t - attackSec) / Math.max(0.1, durationSec), 0, 1)
          : Math.exp(-(t - releaseStart) * 26);
      // Delayed vibrato (~5.6 Hz, +-0.3% depth) so attack pitch is pure
      const vibRamp = clamp((t - 0.09) / 0.16, 0, 1);
      const vib = 1 + 0.003 * vibRamp * Math.sin(TWO_PI * 5.6 * t);
      const wave = sampleTable(KAMANCHA_TABLE, phaseMain);
      const octaveWarmth = Math.sin(TWO_PI * phaseMain) * 0.32;
      const amp = 0.28 * velGain * bowAttack * noteSustain * declickTail;
      const mono = (wave * 0.76 * highRoll + octaveWarmth) * amp;
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase * vib;
    } else if (voice === "chime") {
      // Tuned Orchestral Chime / Marimba-Celesta Bar (Rope Harp)
      const attack = Math.min(1, i / (0.0022 * SAMPLE_RATE));
      const postRelease = t > durationSec ? Math.exp(-(t - durationSec) * 6.5) : 1;
      const decay = Math.exp(-t * 3.2) * postRelease;
      const strikeClick =
        Math.exp(-t * 95) * Math.sin(TWO_PI * f0 * 4 * t) * 0.2 * highRoll;
      const fmIndex = 1.05 * Math.exp(-t * 14) * highRoll;
      const fmMod = Math.sin(TWO_PI * phaseMain * 2) * fmIndex;
      const fund = Math.sin(TWO_PI * phaseMain + fmMod);
      const warm2 = Math.sin(TWO_PI * phaseMain * 2) * 0.22 * Math.exp(-t * 5.5);
      const warm3 = Math.sin(TWO_PI * phaseMain * 3) * 0.08 * Math.exp(-t * 9.0);
      const mono =
        0.36 * velGain * attack * decay * declickTail * (fund + warm2 + warm3) +
        0.2 * velGain * strikeClick * declickTail;
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase;
    } else if (voice === "bell") {
      // Crystal FM Tubular Bell (arpeggios & finales)
      const attack = Math.min(1, i / (0.0025 * SAMPLE_RATE));
      const decay = Math.exp(-t * 2.4);
      const mod =
        Math.sin(TWO_PI * phaseMain * 2) * 1.55 * Math.exp(-t * 8.5) * highRoll +
        Math.sin(TWO_PI * phaseMain * 3) * 0.55 * Math.exp(-t * 16) * highRoll;
      const carrierA = Math.sin(TWO_PI * phaseDetuneA + mod);
      const carrierB = Math.sin(TWO_PI * phaseDetuneB + mod * 0.92);
      const amp = 0.27 * velGain * attack * decay * declickTail;
      sigL = carrierA * amp;
      sigR = carrierB * amp;
      phaseMain += dPhase;
      phaseDetuneA += dPhase * 1.0006;
      phaseDetuneB += dPhase * 0.9994;
    } else if (voice === "pizzicato") {
      // Orchestral Pizzicato Strings (sneaky staccato pluck)
      const attack = Math.min(1, i / (0.003 * SAMPLE_RATE));
      const bodyDecay = Math.exp(-t * 9.5);
      const ks = (ksBuf ? ksBuf[i] : 0) * Math.exp(-t * 7.5) * 0.45;
      const body =
        (Math.sin(TWO_PI * phaseMain) +
          0.36 * Math.sin(TWO_PI * phaseMain * 2) +
          0.14 * Math.sin(TWO_PI * phaseMain * 3)) *
        bodyDecay *
        0.72;
      const mono = 0.36 * velGain * attack * declickTail * (body + ks);
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase;
    } else if (voice === "brass") {
      // Orchestral Horns & Trombones: velocity-coupled brassy bloom
      const attackSec = 0.013;
      const attack = Math.min(1, t / attackSec);
      const releaseStart = Math.max(attackSec, durationSec - 0.025);
      const sustain =
        t < releaseStart ? 1 : Math.exp(-(t - releaseStart) * 28);
      const brassBright = clamp((velocity - 0.35) / 0.6, 0, 1) * highRoll;
      // Brass lip-swell envelope opens harmonics right after attack
      const swell = Math.min(1, t / 0.038) * brassBright;
      const wWarm = sampleTable(BRASS_WARM_TABLE, phaseDetuneA);
      const wBlaze = sampleTable(BRASS_BLAZE_TABLE, phaseDetuneB);
      const waveA = wWarm * (1 - 0.62 * swell) + wBlaze * (0.68 * swell);
      const waveB =
        sampleTable(BRASS_WARM_TABLE, phaseMain) * (1 - 0.62 * swell) +
        sampleTable(BRASS_BLAZE_TABLE, phaseMain) * (0.68 * swell);
      const amp = 0.3 * velGain * attack * sustain * declickTail;
      sigL = waveA * amp;
      sigR = waveB * amp;
      phaseMain += dPhase;
      phaseDetuneA += dPhase * 1.0011;
      phaseDetuneB += dPhase * 0.9989;
    } else if (voice === "lead") {
      // Expressive Woodwind / Strings Lead
      const attack = Math.min(1, t / 0.009);
      const releaseStart = Math.max(0.012, durationSec - 0.022);
      const sustain =
        t < releaseStart
          ? 0.92 + 0.08 * Math.exp(-t * 4)
          : Math.exp(-(t - releaseStart) * 26);
      const vib = 1 + 0.0022 * clamp((t - 0.08) / 0.14, 0, 1) * Math.sin(TWO_PI * 5.3 * t);
      const bright = clamp((velocity - 0.3) / 0.65, 0, 1) * highRoll;
      const w =
        sampleTable(LEAD_SOFT_TABLE, phaseMain) * (1 - 0.55 * bright) +
        sampleTable(LEAD_BRIGHT_TABLE, phaseMain) * (0.65 * bright);
      const mono = 0.31 * velGain * attack * sustain * declickTail * w;
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase * vib;
    } else if (voice === "bass") {
      // Deep Acoustic / Plucked Bass (clear fundamental + warm 2nd/3rd harmonics)
      const attack = Math.min(1, t / 0.005);
      const releaseStart = Math.max(0.01, durationSec - 0.022);
      const env =
        t < releaseStart
          ? 0.58 + 0.42 * Math.exp(-t * 5.2)
          : 0.58 * Math.exp(-(t - releaseStart) * 28);
      const w = sampleTable(BASS_TABLE, phaseMain);
      const mono = 0.36 * velGain * attack * env * declickTail * w;
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase;
    } else if (voice === "arp") {
      // Plucked Harp Arpeggio
      const attack = Math.min(1, i / (0.0025 * SAMPLE_RATE));
      const decay = Math.exp(-t * 4.4);
      const ks = (ksBuf ? ksBuf[i] : 0) * Math.exp(-t * 5.5) * 0.35;
      const body = sampleTable(HARMONY_TABLE, phaseMain) * decay * 0.72;
      const mono = 0.27 * velGain * attack * declickTail * (body + ks);
      sigL = mono;
      sigR = mono;
      phaseMain += dPhase;
    } else {
      // "harmony" — warm detuned stereo strings / pad chord voice
      const attack = Math.min(1, t / 0.018);
      const releaseStart = Math.max(0.02, durationSec - 0.03);
      const env =
        t < releaseStart ? 0.9 : 0.9 * Math.exp(-(t - releaseStart) * 20);
      const wL = sampleTable(HARMONY_TABLE, phaseDetuneA);
      const wR = sampleTable(HARMONY_TABLE, phaseDetuneB);
      const amp = 0.22 * velGain * attack * env * declickTail;
      sigL = wL * amp;
      sigR = wR * amp;
      phaseDetuneA += dPhase * 1.0014;
      phaseDetuneB += dPhase * 0.9986;
    }

    addPannedSample(
      dryL,
      dryR,
      revSendL,
      revSendR,
      totalSamples,
      startSample + i,
      sigL * gainL * 1.414,
      sigR * gainR * 1.414,
      revAmount,
    );
  }
}

function renderDrumIntoMix(
  dryL: Float32Array,
  dryR: Float32Array,
  revSendL: Float32Array,
  revSendR: Float32Array,
  totalSamples: number,
  hit: DrumHit,
  hitIdx: number,
): void {
  const startSample = Math.round(hit.time * SAMPLE_RATE);
  const vel = clamp(hit.velocity, 0.05, 1.0);
  const pan = clamp(hit.pan ?? 0, -0.7, 0.7);
  const angle = ((pan + 1) * Math.PI) / 4;
  const gL = Math.cos(angle) * 1.414;
  const gR = Math.sin(angle) * 1.414;
  const rng = createRng(((hitIdx + 1) * 2246822519) >>> 0);

  if (hit.kind === "kick") {
    const len = Math.round(0.19 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const f = 46 + 98 * Math.exp(-t * 48);
      phase += (TWO_PI * f) / SAMPLE_RATE;
      const env = Math.min(1, i / 48) * Math.exp(-t * 16) * (1 - i / len);
      const click = Math.exp(-t * 220) * (rng() * 2 - 1) * 0.12;
      const s = (Math.sin(phase) + click) * 0.24 * vel * env;
      addPannedSample(dryL, dryR, revSendL, revSendR, totalSamples, startSample + i, s * gL, s * gR, 0.04);
    }
  } else if (hit.kind === "snare") {
    const len = Math.round(0.14 * SAMPLE_RATE);
    let bp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, i / 36);
      const noise = rng() * 2 - 1;
      bp += 0.28 * (noise - bp);
      const high = noise - bp;
      const body = Math.sin(TWO_PI * 186 * t) * Math.exp(-t * 36);
      const snap = high * Math.exp(-t * 24) * 0.65;
      const s = (body * 0.5 + snap) * 0.16 * vel * attack * (1 - i / len);
      addPannedSample(dryL, dryR, revSendL, revSendR, totalSamples, startSample + i, s * gL, s * gR, 0.14);
    }
  } else if (hit.kind === "hat" || hit.kind === "openHat") {
    const dur = hit.kind === "openHat" ? 0.14 : 0.045;
    const decayRate = hit.kind === "openHat" ? 22 : 68;
    const len = Math.round(dur * SAMPLE_RATE);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const n = rng() * 2 - 1;
      const hp = n - prev;
      prev = n * 0.86;
      const env = Math.min(1, i / 24) * Math.exp(-t * decayRate) * (1 - i / len);
      const s = hp * 0.075 * vel * env;
      addPannedSample(dryL, dryR, revSendL, revSendR, totalSamples, startSample + i, s * gL, s * gR, 0.08);
    }
  } else if (hit.kind === "frameDum") {
    // Azerbaijani Qaval / Naghara warm low center stroke ("Dum")
    const len = Math.round(0.22 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const f = 112 + 34 * Math.exp(-t * 42);
      phase += (TWO_PI * f) / SAMPLE_RATE;
      const skin = Math.sin(phase) + 0.28 * Math.sin(phase * 1.59) * Math.exp(-t * 28);
      const thump = (rng() * 2 - 1) * Math.exp(-t * 140) * 0.14;
      const env = Math.min(1, i / 42) * Math.exp(-t * 13.5) * (1 - i / len);
      const s = (skin + thump) * 0.18 * vel * env;
      addPannedSample(dryL, dryR, revSendL, revSendR, totalSamples, startSample + i, s * gL, s * gR, 0.12);
    }
  } else if (hit.kind === "frameTak") {
    // Azerbaijani Qaval crisp rim stroke + subtle ring shimmer ("Tak")
    const len = Math.round(0.095 * SAMPLE_RATE);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const rim =
        Math.sin(TWO_PI * 392 * t) * Math.exp(-t * 46) +
        0.45 * Math.sin(TWO_PI * 628 * t) * Math.exp(-t * 62);
      const n = rng() * 2 - 1;
      const jingle = (n - prev) * Math.exp(-t * 55) * 0.28;
      prev = n * 0.82;
      const env = Math.min(1, i / 28) * (1 - i / len);
      const s = (rim * 0.65 + jingle) * 0.13 * vel * env;
      addPannedSample(dryL, dryR, revSendL, revSendR, totalSamples, startSample + i, s * gL, s * gR, 0.14);
    }
  }
}

class CombFilter {
  private readonly buf: Float32Array;
  private idx = 0;
  private filterStore = 0;
  private readonly feedback: number;
  private readonly damp1: number;
  private readonly damp2: number;

  constructor(delaySamples: number, feedback: number, damp: number) {
    this.buf = new Float32Array(delaySamples);
    this.feedback = feedback;
    this.damp1 = damp;
    this.damp2 = 1 - damp;
  }

  process(input: number): number {
    const out = this.buf[this.idx];
    this.filterStore = out * this.damp2 + this.filterStore * this.damp1;
    this.buf[this.idx] = input + this.filterStore * this.feedback;
    this.idx++;
    if (this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

class AllpassFilter {
  private readonly buf: Float32Array;
  private idx = 0;
  private readonly feedback: number;

  constructor(delaySamples: number, feedback = 0.5) {
    this.buf = new Float32Array(delaySamples);
    this.feedback = feedback;
  }

  process(input: number): number {
    const bufOut = this.buf[this.idx];
    const out = -input + bufOut;
    this.buf[this.idx] = input + bufOut * this.feedback;
    this.idx++;
    if (this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

function applyLoopingStereoReverb(
  dryL: Float32Array,
  dryR: Float32Array,
  sendL: Float32Array,
  sendR: Float32Array,
): void {
  const n = dryL.length;
  const combsL = [
    new CombFilter(1423, 0.79, 0.28),
    new CombFilter(1657, 0.77, 0.3),
    new CombFilter(1879, 0.75, 0.32),
    new CombFilter(2111, 0.73, 0.34),
  ];
  const combsR = [
    new CombFilter(1459, 0.79, 0.28),
    new CombFilter(1693, 0.77, 0.3),
    new CombFilter(1907, 0.75, 0.32),
    new CombFilter(2143, 0.73, 0.34),
  ];
  const apL1 = new AllpassFilter(241, 0.5);
  const apL2 = new AllpassFilter(557, 0.5);
  const apR1 = new AllpassFilter(263, 0.5);
  const apR2 = new AllpassFilter(587, 0.5);

  // Prime reverb using the last 2.0 seconds so loop seam [n-1 -> 0] is acoustically continuous
  const primeLen = Math.min(n, Math.round(2.0 * SAMPLE_RATE));
  for (let i = n - primeLen; i < n; i++) {
    const inL = sendL[i] * 0.25;
    const inR = sendR[i] * 0.25;
    let accL = 0;
    let accR = 0;
    for (let c = 0; c < 4; c++) {
      accL += combsL[c].process(inL);
      accR += combsR[c].process(inR);
    }
    apL2.process(apL1.process(accL));
    apR2.process(apR1.process(accR));
  }

  for (let i = 0; i < n; i++) {
    const inL = sendL[i] * 0.25;
    const inR = sendR[i] * 0.25;
    let accL = 0;
    let accR = 0;
    for (let c = 0; c < 4; c++) {
      accL += combsL[c].process(inL);
      accR += combsR[c].process(inR);
    }
    const wetL = apL2.process(apL1.process(accL));
    const wetR = apR2.process(apR1.process(accR));
    dryL[i] += wetL * 0.85 + wetR * 0.15;
    dryR[i] += wetR * 0.85 + wetL * 0.15;
  }
}

export function encodeStereoPcm16Wav(left: Float32Array, right: Float32Array): Buffer {
  if (left.length !== right.length) {
    throw new RangeError("Stereo channel length mismatch");
  }
  const frames = left.length;
  const dataBytes = frames * 4;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(2, 22); // 2 channels (stereo)
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 4, 28); // byteRate
  wav.writeUInt16LE(4, 32); // blockAlign
  wav.writeUInt16LE(16, 34); // bitsPerSample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const cl = clamp(left[i], -1, 1);
    const cr = clamp(right[i], -1, 1);
    wav.writeInt16LE(Math.round(cl * 32767), offset);
    wav.writeInt16LE(Math.round(cr * 32767), offset + 2);
    offset += 4;
  }
  return wav;
}

/**
 * Renders a full stereo 48 kHz PCM16 WAV from a PieceScore with:
 * - Karplus-Strong plucks, bowed/orchestral wavetables, FM chimes & bells, detuned pads/drones,
 *   and synthesized percussion
 * - Loop-continuous stereo reverb send, DC blocker, gentle stereo bus compressor,
 *   calibrated RMS (-15.5 to -13.5 dBFS) and soft peak limiter (peak <= 0.92).
 */
export function synthesizePieceWav(score: PieceScore): Buffer {
  const totalSamples = score.totalFrames * SAMPLES_PER_FRAME;
  const dryL = new Float32Array(totalSamples);
  const dryR = new Float32Array(totalSamples);
  const revSendL = new Float32Array(totalSamples);
  const revSendR = new Float32Array(totalSamples);

  // 1. Continuous soft drones / pads
  for (const drone of score.drones) {
    const s0 = Math.max(0, Math.round(drone.startTime * SAMPLE_RATE));
    const s1 = Math.min(totalSamples, Math.round(drone.endTime * SAMPLE_RATE));
    const len = s1 - s0;
    if (len <= 0) continue;
    const f0 = midiToHz(drone.midi);
    const fadeSamples = Math.min(Math.floor(len * 0.25), Math.round(0.08 * SAMPLE_RATE));
    // If spanning [0 .. totalSamples], keep phase continuous at loop boundary by integer cycles!
    const isFullLoop = s0 === 0 && s1 === totalSamples;
    const cyclesA = isFullLoop ? Math.max(1, Math.round((f0 * totalSamples) / SAMPLE_RATE)) : 0;
    const dPhase = isFullLoop ? cyclesA / totalSamples : f0 / SAMPLE_RATE;

    let p1 = 0;
    let p2 = 0.25;
    let p3 = 0.62;
    let p5 = 0.11;
    for (let i = 0; i < len; i++) {
      let env = 1;
      if (!isFullLoop) {
        if (i < fadeSamples) env *= i / fadeSamples;
        const rem = len - 1 - i;
        if (rem < fadeSamples) env *= rem / fadeSamples;
      }
      const breathe = 0.86 + 0.14 * Math.sin((TWO_PI * i * 3) / totalSamples);
      const fifth = drone.withFifth ? 0.36 * Math.sin(TWO_PI * p5) : 0;
      const l = (Math.sin(TWO_PI * p1) * 0.62 + Math.sin(TWO_PI * p2) * 0.38 + fifth) * drone.gain * env * breathe;
      const r = (Math.sin(TWO_PI * p1) * 0.62 + Math.sin(TWO_PI * p3) * 0.38 + fifth) * drone.gain * env * breathe;
      dryL[s0 + i] += l;
      dryR[s0 + i] += r;
      revSendL[s0 + i] += l * 0.22;
      revSendR[s0 + i] += r * 0.22;
      p1 += dPhase;
      p2 += isFullLoop ? (cyclesA + 2) / totalSamples : dPhase * 1.0018;
      p3 += isFullLoop ? Math.max(1, cyclesA - 2) / totalSamples : dPhase * 0.9982;
      p5 += isFullLoop ? Math.round(cyclesA * 1.5) / totalSamples : dPhase * 1.5;
    }
  }

  // 2. Risers (short tension sweeps before payoff)
  score.risers.forEach((riser, rIdx) => {
    const s0 = Math.max(0, Math.round(riser.startTime * SAMPLE_RATE));
    const s1 = Math.min(totalSamples, Math.round(riser.endTime * SAMPLE_RATE));
    const len = s1 - s0;
    if (len <= 64) return;
    const fStart = midiToHz(riser.startMidi);
    const fEnd = midiToHz(riser.endMidi);
    const rng = createRng(((rIdx + 7) * 3266489917) >>> 0);
    let phase = 0;
    let lp = 0;
    const fadeOut = Math.min(Math.floor(len * 0.2), Math.round(0.03 * SAMPLE_RATE));
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const f = fStart * Math.pow(fEnd / fStart, u * u);
      phase += (TWO_PI * f) / SAMPLE_RATE;
      const noise = rng() * 2 - 1;
      const cutoff = 0.03 + 0.26 * u * u;
      lp += cutoff * (noise - lp);
      const bp = noise - lp;
      const swell = u * u;
      const rem = len - 1 - i;
      const tail = rem < fadeOut ? rem / fadeOut : 1;
      const sig = (Math.sin(phase) * 0.55 + bp * 0.45) * riser.gain * swell * tail;
      dryL[s0 + i] += sig * 0.92;
      dryR[s0 + i] += sig * 1.08;
      revSendL[s0 + i] += sig * 0.32;
      revSendR[s0 + i] += sig * 0.32;
    }
  });

  // 3. Pitched musical notes
  for (let i = 0; i < score.notes.length; i++) {
    const note = score.notes[i];
    if (note.time < 0 || note.time >= score.durationSec) {
      throw new RangeError(`Note ${i} out of bounds: time=${note.time}`);
    }
    const startSample = Math.round(note.time * SAMPLE_RATE);
    renderVoiceIntoMix(
      dryL,
      dryR,
      revSendL,
      revSendR,
      totalSamples,
      startSample,
      note.duration,
      note.midi,
      note.velocity,
      note.voice,
      note.pan,
      i,
    );
  }

  // 4. Light synthesized percussion
  for (let i = 0; i < score.drums.length; i++) {
    const hit = score.drums[i];
    if (hit.time < 0 || hit.time >= score.durationSec) continue;
    renderDrumIntoMix(dryL, dryR, revSendL, revSendR, totalSamples, hit, i);
  }

  // 5. Loop-continuous stereo Schroeder reverb
  applyLoopingStereoReverb(dryL, dryR, revSendL, revSendR);

  // 6. High-pass DC blocker + exact zero-mean removal
  let prevInL = dryL[totalSamples - 1];
  let prevInR = dryR[totalSamples - 1];
  let prevOutL = 0;
  let prevOutR = 0;
  for (let i = 0; i < totalSamples; i++) {
    const xL = dryL[i];
    const xR = dryR[i];
    prevOutL = xL - prevInL + 0.9993 * prevOutL;
    prevOutR = xR - prevInR + 0.9993 * prevOutR;
    prevInL = xL;
    prevInR = xR;
    dryL[i] = prevOutL;
    dryR[i] = prevOutR;
  }

  // 7. Pre-normalize to nominal RMS, then apply gentle stereo-linked bus compressor
  let sumSq = 0;
  for (let i = 0; i < totalSamples; i++) {
    sumSq += 0.5 * (dryL[i] * dryL[i] + dryR[i] * dryR[i]);
  }
  const initialRms = Math.sqrt(sumSq / totalSamples);
  const preGain = initialRms > 1e-6 ? 0.21 / initialRms : 1;

  const thresh = 0.22; // ~ -13.1 dBFS
  const ratio = 2.2;
  const attackCoeff = Math.exp(-1 / (0.012 * SAMPLE_RATE));
  const releaseCoeff = Math.exp(-1 / (0.11 * SAMPLE_RATE));
  let env = 0.15;

  // Prime compressor envelope on last 0.5s for seamless loop dynamics
  const compPrime = Math.min(totalSamples, Math.round(0.5 * SAMPLE_RATE));
  for (let i = totalSamples - compPrime; i < totalSamples; i++) {
    const det = Math.max(Math.abs(dryL[i] * preGain), Math.abs(dryR[i] * preGain));
    env = det > env ? attackCoeff * env + (1 - attackCoeff) * det : releaseCoeff * env + (1 - releaseCoeff) * det;
  }

  for (let i = 0; i < totalSamples; i++) {
    const l = dryL[i] * preGain;
    const r = dryR[i] * preGain;
    const det = Math.max(Math.abs(l), Math.abs(r));
    env = det > env ? attackCoeff * env + (1 - attackCoeff) * det : releaseCoeff * env + (1 - releaseCoeff) * det;
    let compGain = 1;
    if (env > thresh) {
      const dbOver = 20 * Math.log10(env / thresh);
      const dbReduced = dbOver * (1 - 1 / ratio);
      compGain = Math.pow(10, -dbReduced / 20);
    }
    dryL[i] = l * compGain;
    dryR[i] = r * compGain;
  }

  // 8. Final RMS calibration (~ -14.6 dBFS, strictly inside [-18, -12] dBFS) + soft limiter (<= 0.90)
  let postSq = 0;
  for (let i = 0; i < totalSamples; i++) {
    postSq += 0.5 * (dryL[i] * dryL[i] + dryR[i] * dryR[i]);
  }
  const postRms = Math.sqrt(postSq / totalSamples);
  const targetRms = 0.186; // -14.6 dBFS
  const finalGain = postRms > 1e-6 ? targetRms / postRms : 1;

  const knee = 0.66;
  const ceiling = 0.9; // strictly <= 0.95 requirement
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < totalSamples; i++) {
    const xL = dryL[i] * finalGain;
    const xR = dryR[i] * finalGain;
    const aL = Math.abs(xL);
    const aR = Math.abs(xR);
    const outL =
      aL <= knee
        ? xL
        : Math.sign(xL) * (knee + (ceiling - knee) * Math.tanh((aL - knee) / (ceiling - knee)));
    const outR =
      aR <= knee
        ? xR
        : Math.sign(xR) * (knee + (ceiling - knee) * Math.tanh((aR - knee) / (ceiling - knee)));
    dryL[i] = outL;
    dryR[i] = outR;
    sumL += outL;
    sumR += outR;
  }

  // Exact zero-mean DC correction + 3 ms loop-boundary micro-cross-smooth for click-free repeat
  const meanL = sumL / totalSamples;
  const meanR = sumR / totalSamples;
  for (let i = 0; i < totalSamples; i++) {
    dryL[i] = clamp(dryL[i] - meanL, -ceiling, ceiling);
    dryR[i] = clamp(dryR[i] - meanR, -ceiling, ceiling);
  }
  const seamSamples = Math.min(144, Math.floor(totalSamples / 8));
  const midL = 0.5 * (dryL[0] + dryL[totalSamples - 1]);
  const midR = 0.5 * (dryR[0] + dryR[totalSamples - 1]);
  for (let k = 0; k < seamSamples; k++) {
    const w = 1 - k / seamSamples;
    dryL[k] = dryL[k] * (1 - 0.5 * w) + midL * (0.5 * w);
    dryR[k] = dryR[k] * (1 - 0.5 * w) + midR * (0.5 * w);
    const endIdx = totalSamples - 1 - k;
    dryL[endIdx] = dryL[endIdx] * (1 - 0.5 * w) + midL * (0.5 * w);
    dryR[endIdx] = dryR[endIdx] * (1 - 0.5 * w) + midR * (0.5 * w);
  }

  return encodeStereoPcm16Wav(dryL, dryR);
}
