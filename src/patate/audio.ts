import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../audio.ts";
import { VIDEO } from "../settings.ts";
import type { PatateTrace } from "./sim.ts";
import type { PatateVoiceStem } from "./themes.ts";

const stemCache = new Map<PatateVoiceStem, Float32Array>();

export function loadFrenchStemPcm(stem: PatateVoiceStem): Float32Array {
  const cached = stemCache.get(stem);
  if (cached) return cached;

  const mp3Url = new URL(`../../public/audio/patate/${stem}.mp3`, import.meta.url);
  const mp3Path = fileURLToPath(mp3Url);
  if (!existsSync(mp3Path)) {
    throw new Error(`Missing French voice stem file: ${mp3Path}`);
  }

  const res = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      mp3Path,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(
      `ffmpeg failed decoding ${stem}.mp3: ${res.stderr?.toString("utf8") ?? ""}`,
    );
  }

  const buf = res.stdout;
  const sampleCount = Math.floor(buf.byteLength / 4);
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = buf.readFloatLE(i * 4);
  }
  stemCache.set(stem, pcm);
  return pcm;
}

/**
 * Coupled pitch + speed resampling (equivalent to ffmpeg asetrate=SR*rate,aresample=SR)
 * using 4-point Catmull-Rom cubic interpolation for clean chipmunk highs & boss lows.
 */
export function resampleCoupledPitchSpeed(
  src: Float32Array,
  rate: number,
  addBossSubWarmth: boolean,
): Float32Array {
  if (src.length < 4) return new Float32Array(0);
  const outLen = Math.max(1, Math.floor((src.length - 1) / rate));
  const out = new Float32Array(outLen);

  let lowpassState = 0;
  for (let i = 0; i < outLen; i++) {
    const pos = i * rate;
    const idx = Math.floor(pos);
    const frac = pos - idx;

    const p0 = src[Math.max(0, idx - 1)];
    const p1 = src[Math.min(src.length - 1, idx)];
    const p2 = src[Math.min(src.length - 1, idx + 1)];
    const p3 = src[Math.min(src.length - 1, idx + 2)];

    const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const a1 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    const a2 = -0.5 * p0 + 0.5 * p2;
    const a3 = p1;

    let sample = ((a0 * frac + a1) * frac + a2) * frac + a3;
    if (addBossSubWarmth) {
      // One-pole 135 Hz low-pass chest resonance + gentle harmonic saturation for Tier 8 Boss
      lowpassState += 0.0175 * (sample - lowpassState);
      sample = Math.tanh(sample * 1.28) * 0.86 + lowpassState * 0.42;
    }
    out[i] = sample;
  }
  return out;
}

export interface ScheduledVoiceClip {
  startSample: number;
  endSample: number; // exclusive
  fadeOutSamples: number;
  tier: number;
  pcm: Float32Array;
  gain: number;
}

function encodeMonoPcm16Wav(samples: Float32Array): Buffer {
  const sampleCount = samples.length;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return wav;
}

/**
 * Decides which French announcement plays when. A line that is interrupted by the next merge is cut after at least
 * 0.28 s ("La patate—") and ends exactly where the next line starts, with its fade inside it, so two voices never
 * play over each other. Exported so the schedule can be checked.
 */
export function scheduleFrenchVoices(trace: PatateTrace): (ScheduledVoiceClip & { isFirstUnlock: boolean })[] {
  const sceneEndSample = trace.sceneFrames * SAMPLES_PER_FRAME;
  const minSpokenSamples = Math.round(0.28 * SAMPLE_RATE); // >= 0.28s ("La patate—") before interrupt!
  const interruptFadeSamples = Math.round(0.035 * SAMPLE_RATE); // 35ms click-free fade
  const maxVoiceEndSample = sceneEndSample - Math.round(0.05 * SAMPLE_RATE);

  const scheduledVoices: (ScheduledVoiceClip & { isFirstUnlock: boolean })[] = [];
  for (const ev of trace.events) {
    if (ev.type !== "merge") continue;
    // Once Boss Tier 8 merges, let the Boss announcement own the spotlight cleanly!
    if (
      trace.bossMergeFrame !== null &&
      ev.frame > trace.bossMergeFrame &&
      ev.tier < 8
    ) {
      continue;
    }
    const triggerSample = ev.frame * SAMPLES_PER_FRAME + Math.round(0.012 * SAMPLE_RATE);
    if (triggerSample >= maxVoiceEndSample - minSpokenSamples) continue;

    const basePcm = loadFrenchStemPcm(ev.stem);
    const pitchedPcm = resampleCoupledPitchSpeed(
      basePcm,
      ev.playbackRate,
      ev.tier === 8,
    );

    const prev =
      scheduledVoices.length > 0
        ? scheduledVoices[scheduledVoices.length - 1]
        : null;

    let startSample = triggerSample;
    if (prev && prev.endSample > triggerSample) {
      // Protect Tiers 6..8 (Codexienne, Claude-Codienne, Oyrenienne) and first-time tier unlocks
      // from being cut short by strictly lower-tier background merges; ascending chains (ev.tier >= prev.tier) still stutter!
      if ((prev.tier >= 6 || prev.isFirstUnlock) && ev.tier < prev.tier) {
        continue;
      }
      // Enforce >= 0.28s of the previous phrase before interrupting ("La patate— La patate—"). The cut line ends
      // exactly where the next one starts (its fade is inside it), so two voices never overlap.
      const earliestCut = prev.startSample + minSpokenSamples;
      const cutAt = Math.max(triggerSample, earliestCut);
      if (cutAt < prev.endSample) {
        prev.endSample = cutAt;
        prev.fadeOutSamples = Math.min(interruptFadeSamples, cutAt - prev.startSample);
      }
      startSample = cutAt;
    }

    if (startSample >= maxVoiceEndSample - Math.round(0.18 * SAMPLE_RATE)) {
      continue;
    }

    const naturalEnd = startSample + pitchedPcm.length;
    const clampedEnd = Math.min(maxVoiceEndSample, naturalEnd);
    const tierGain = ev.tier === 8 ? 1.06 : ev.tier >= 6 ? 0.98 : 0.92;

    scheduledVoices.push({
      startSample,
      endSample: clampedEnd,
      fadeOutSamples:
        clampedEnd < naturalEnd
          ? Math.round(0.045 * SAMPLE_RATE)
          : Math.round(0.02 * SAMPLE_RATE),
      tier: ev.tier,
      isFirstUnlock: ev.isFirstUnlock,
      pcm: pitchedPcm,
      gain: tierGain,
    });
  }
  return scheduledVoices;
}

export function synthesizePatateWav(trace: PatateTrace): Buffer {
  const totalSamples = trace.totalFrames * SAMPLES_PER_FRAME;
  const sceneEndSample = trace.sceneFrames * SAMPLES_PER_FRAME;
  const mix = new Float32Array(totalSamples);

  // 1. Tactile Zero-Music Gameplay SFX (rubbery drops, muted bounces, wet bubble-pops, Tier-8 boom)
  for (const ev of trace.events) {
    const s0 = ev.frame * SAMPLES_PER_FRAME;
    if (s0 < 0 || s0 >= sceneEndSample) continue;

    if (ev.type === "drop") {
      const len = Math.round(0.036 * SAMPLE_RATE);
      for (let i = 0; i < len && s0 + i < sceneEndSample; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 85);
        const freq = 225 - 2100 * t;
        mix[s0 + i] += 0.052 * env * Math.sin(2 * Math.PI * freq * t);
      }
    } else if (ev.type === "bounce") {
      const len = Math.round(0.052 * SAMPLE_RATE);
      const baseF = Math.max(88, 198 - ev.tier * 11);
      const velGain = Math.min(1.25, Math.max(0.45, ev.speed / 480));
      for (let i = 0; i < len && s0 + i < sceneEndSample; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.003) * Math.exp(-t * 68);
        const phase = 2 * Math.PI * (baseF * t - 420 * t * t);
        mix[s0 + i] += 0.068 * velGain * env * Math.sin(phase);
      }
    } else if (ev.type === "merge") {
      // Wet cartoon Suika bubble-pop + warm sub-thump!
      const popLen = Math.round(0.068 * SAMPLE_RATE);
      const fStart = 250 + (8 - ev.tier) * 28;
      const fSweep = fStart * 1.15;
      for (let i = 0; i < popLen && s0 + i < sceneEndSample; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.003) * Math.exp(-t * 48);
        const phase =
          2 * Math.PI * (fStart * t + 0.5 * (fSweep / 0.068) * t * t);
        mix[s0 + i] += 0.22 * env * Math.sin(phase);
      }

      const subLen = Math.round((ev.tier === 8 ? 0.52 : 0.11) * SAMPLE_RATE);
      const subF = ev.tier === 8 ? 84 : 122 - ev.tier * 6;
      const subAmp = ev.tier === 8 ? 0.31 : 0.14 + ev.tier * 0.012;
      for (let i = 0; i < subLen && s0 + i < sceneEndSample; i++) {
        const t = i / SAMPLE_RATE;
        const env =
          Math.min(1, t / 0.005) *
          Math.exp(-t * (ev.tier === 8 ? 6.2 : 28));
        const instPhase = 2 * Math.PI * (subF * t - (ev.tier === 8 ? 38 : 90) * t * t);
        mix[s0 + i] += subAmp * env * Math.sin(instPhase);
      }

      if (ev.tier === 8) {
        // Subtle celebratory crystal sparkle arpeggio tucked gently beneath the deep French boss voice
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((hz, idx) => {
          const ns = s0 + Math.round((0.04 + idx * 0.055) * SAMPLE_RATE);
          const nLen = Math.round(0.55 * SAMPLE_RATE);
          for (let i = 0; i < nLen && ns + i < sceneEndSample; i++) {
            const t = i / SAMPLE_RATE;
            const env = Math.min(1, t / 0.008) * Math.exp(-t * 5.8);
            mix[ns + i] +=
              0.065 *
              env *
              (Math.sin(2 * Math.PI * hz * t) +
                0.25 * Math.sin(4 * Math.PI * hz * t));
          }
        });
      }
    }
  }

  // 2. Comedic French Pitch-Scaled Voice Announcements + Chain-Interrupt Stutter Engine
  const scheduledVoices = scheduleFrenchVoices(trace);

  // Render scheduled French voices into mix
  const fadeInSamples = Math.round(0.008 * SAMPLE_RATE);
  for (const clip of scheduledVoices) {
    const clipLen = clip.endSample - clip.startSample;
    for (let i = 0; i < clipLen && i < clip.pcm.length; i++) {
      const dst = clip.startSample + i;
      if (dst >= sceneEndSample) break;
      let env = 1;
      if (i < fadeInSamples) {
        env *= i / fadeInSamples;
      }
      const rem = clipLen - 1 - i;
      if (rem < clip.fadeOutSamples && clip.fadeOutSamples > 0) {
        env *= rem / clip.fadeOutSamples;
      }
      mix[dst] += clip.pcm[i] * clip.gain * env;
    }
  }

  // 3. Shared Closing End-Card Warm Major-Ninth Chord (the last 3 s of the video)
  const root = trace.spec.closingRootHz;
  const chordRatios = [1, 5 / 4, 3 / 2, 2, 9 / 4];
  chordRatios.forEach((ratio, idx) => {
    const start =
      sceneEndSample + Math.round((0.03 + idx * 0.055) * SAMPLE_RATE);
    const durSamples = Math.round(2.55 * SAMPLE_RATE);
    const freq = root * ratio;
    const amp = idx === 0 ? 0.16 : 0.115;
    for (let i = 0; i < durSamples && start + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.018);
      const decay = Math.exp(-t * 1.45);
      const endRem = (totalSamples - 1 - (start + i)) / (0.18 * SAMPLE_RATE);
      const tail = Math.max(0, Math.min(1, endRem));
      mix[start + i] +=
        amp *
        attack *
        decay *
        tail *
        (Math.sin(2 * Math.PI * freq * t) +
          0.2 * Math.sin(4 * Math.PI * freq * t));
    }
  });

  // 4. Calibrate integrated loudness to ~ -15 LUFS with true peak <= -1.6 dBTP (0.83 linear)
  let sumSq = 0;
  let activeCount = 0;
  const blockSize = Math.round(0.1 * SAMPLE_RATE); // 100ms gating blocks
  for (let b = 0; b + blockSize <= totalSamples; b += blockSize) {
    let bSq = 0;
    for (let i = 0; i < blockSize; i++) {
      bSq += mix[b + i] * mix[b + i];
    }
    const rms = Math.sqrt(bSq / blockSize);
    if (rms > 0.008) {
      sumSq += bSq;
      activeCount += blockSize;
    }
  }

  const gatedRms =
    activeCount > 0 ? Math.sqrt(sumSq / activeCount) : 0.1;
  // Target gated RMS ~ 0.195 yields ~ -15.0 LUFS for speech-dominant mono program audio
  const targetGain = Math.max(0.5, Math.min(2.6, 0.195 / Math.max(1e-4, gatedRms)));

  const ceiling = 0.81; // ~ -1.83 dBFS peak headroom for AAC / EBU R128 true-peak compliance
  for (let i = 0; i < totalSamples; i++) {
    const x = mix[i] * targetGain;
    // Smooth soft-knee limiter above 0.62
    const ax = Math.abs(x);
    if (ax <= 0.62) {
      mix[i] = x;
    } else {
      const excess = (ax - 0.62) / (ceiling - 0.62);
      const compressed = 0.62 + (ceiling - 0.62) * Math.tanh(excess);
      mix[i] = Math.sign(x) * compressed;
    }
  }

  return encodeMonoPcm16Wav(mix);
}

export { VIDEO };
