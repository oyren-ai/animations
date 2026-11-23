import {
  addBassNote,
  addKick,
  addPadChord,
  addPluck,
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  extractFrameAudioFeatures,
  panFromScreenX,
  type FrameAudioFeatures,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, SCENE_FRAMES, TOTAL_FRAMES, VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";
import { colorWithAlpha, theme } from "../theme.ts";

export const WALL_CASCADE_BOUNDS = {
  left: 0,
  right: VIDEO.width, // 1080
  top: 0,
  bottom: VIDEO.height, // 1920
} as const;

export const WALL_CASCADE_SCENE_FRAMES = SCENE_FRAMES; // 720
export const WALL_CASCADE_CLOSING_FRAMES = CLOSING_FRAMES; // 180
export const WALL_CASCADE_TOTAL_FRAMES = TOTAL_FRAMES; // 900

export type WallSide = "left" | "right" | "top" | "bottom";

export interface HarmonicStringDef {
  index: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  frequency: number;
  noteName: string;
  color: string;
}

export const HARMONIC_STRINGS: readonly HarmonicStringDef[] = [
  { index: 0, ax: 0, ay: 180, bx: 1080, by: 520, frequency: 293.665, noteName: "D4", color: theme.colors.gpuHud.cyan },
  { index: 1, ax: 1080, ay: 180, bx: 0, by: 520, frequency: 349.228, noteName: "F4", color: theme.colors.primary },
  { index: 2, ax: 0, ay: 640, bx: 1080, by: 960, frequency: 391.995, noteName: "G4", color: theme.colors.gpuHud.pink },
  { index: 3, ax: 1080, ay: 640, bx: 0, by: 960, frequency: 440.0, noteName: "A4", color: theme.colors.gpuHud.violet },
  { index: 4, ax: 0, ay: 960, bx: 1080, by: 1280, frequency: 523.251, noteName: "C5", color: theme.colors.gpuHud.teal },
  { index: 5, ax: 1080, ay: 960, bx: 0, by: 1280, frequency: 587.33, noteName: "D5", color: theme.colors.gpuHud.amber },
  { index: 6, ax: 0, ay: 1400, bx: 1080, by: 1740, frequency: 659.255, noteName: "E5", color: theme.colors.gpuHud.cyan },
  { index: 7, ax: 1080, ay: 1400, bx: 0, by: 1740, frequency: 880.0, noteName: "A5", color: theme.colors.primary },
] as const;

export interface CascadeEvent {
  frame: number;
  kind: "wall" | "string";
  x: number;
  y: number;
  wall?: WallSide;
  stringIndex?: number;
  orbIndex: number;
  speed: number;
}

export interface OrbSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
}

export interface WallCascadeFrame {
  orbs: OrbSnapshot[];
  wallEnergy: Record<WallSide, number>;
  stringPlucks: { amp: number; phase: number; u: number }[];
  totalPlucks: number;
  totalBounces: number;
}

export interface WallCascadeTrace {
  seed: number;
  frames: WallCascadeFrame[];
  events: CascadeEvent[];
  minXReached: number;
  maxXReached: number;
  minYReached: number;
  maxYReached: number;
}

const ORB_PALETTE = [
  theme.colors.primary,
  theme.colors.gpuHud.cyan,
  theme.colors.gpuHud.pink,
  theme.colors.gpuHud.teal,
  theme.colors.gpuHud.violet,
  theme.colors.gpuHud.amber,
  theme.colors.gpuHud.blue,
] as const;

function createRng(seed: number) {
  let s = seed | 0 || 0x12345678;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function signedSegmentDistance(
  px: number,
  py: number,
  s: HarmonicStringDef,
): { dist: number; u: number } {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const rx = px - s.ax;
  const ry = py - s.ay;
  const dist = rx * nx + ry * ny;
  const u = (rx * dx + ry * dy) / (len * len);
  return { dist, u };
}

let cachedCascadeTrace: WallCascadeTrace | null = null;
let cachedCascadeFeatures: { buffer: StereoBuffer; features: FrameAudioFeatures[] } | null = null;
let cachedCascadeAudio: { buffer: StereoBuffer; wav: Uint8Array; features: FrameAudioFeatures[] } | null = null;

export function simulateWallCascade(seed = 20261116): WallCascadeTrace {
  if (cachedCascadeTrace && cachedCascadeTrace.seed === seed) return cachedCascadeTrace;

  const rand = createRng(seed);
  const orbCount = 14;
  const substeps = 8;
  const dt = 1 / (VIDEO.fps * substeps);

  const orbs = Array.from({ length: orbCount }, (_, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = 160 + col * 380 + (rand() - 0.5) * 90;
    const y = 150 + row * 390 + (rand() - 0.5) * 90;
    const angle = (idx * 2.399963) + rand() * 0.35;
    const speed = 760 + rand() * 210;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: idx % 4 === 0 ? 26 : 22,
      color: ORB_PALETTE[idx % ORB_PALETTE.length],
    };
  });

  // Track last signed distance to each string for exact crossing detection
  const lastSign: number[][] = orbs.map((orb) =>
    HARMONIC_STRINGS.map((str) => Math.sign(signedSegmentDistance(orb.x, orb.y, str).dist) || 1),
  );
  const cooldown: number[][] = orbs.map(() => new Array(HARMONIC_STRINGS.length).fill(-99));

  const wallEnergy: Record<WallSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  const stringState = HARMONIC_STRINGS.map(() => ({ amp: 0, phase: 0, u: 0.5 }));
  const events: CascadeEvent[] = [];
  const frames: WallCascadeFrame[] = [];

  let minXReached = Infinity;
  let maxXReached = -Infinity;
  let minYReached = Infinity;
  let maxYReached = -Infinity;
  let totalPlucks = 0;
  let totalBounces = 0;

  for (let f = 0; f < WALL_CASCADE_SCENE_FRAMES; f++) {
    for (let step = 0; step < substeps; step++) {
      // Advance positions & true 0..1080 x 0..1920 outer screen wall bounces
      for (let i = 0; i < orbs.length; i++) {
        const b = orbs[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (b.x - b.r <= WALL_CASCADE_BOUNDS.left) {
          b.x = WALL_CASCADE_BOUNDS.left + b.r;
          b.vx = Math.abs(b.vx);
          wallEnergy.left = 1;
          totalBounces++;
          events.push({
            frame: f,
            kind: "wall",
            wall: "left",
            x: WALL_CASCADE_BOUNDS.left,
            y: b.y,
            orbIndex: i,
            speed: Math.hypot(b.vx, b.vy),
          });
        } else if (b.x + b.r >= WALL_CASCADE_BOUNDS.right) {
          b.x = WALL_CASCADE_BOUNDS.right - b.r;
          b.vx = -Math.abs(b.vx);
          wallEnergy.right = 1;
          totalBounces++;
          events.push({
            frame: f,
            kind: "wall",
            wall: "right",
            x: WALL_CASCADE_BOUNDS.right,
            y: b.y,
            orbIndex: i,
            speed: Math.hypot(b.vx, b.vy),
          });
        }

        if (b.y - b.r <= WALL_CASCADE_BOUNDS.top) {
          b.y = WALL_CASCADE_BOUNDS.top + b.r;
          b.vy = Math.abs(b.vy);
          wallEnergy.top = 1;
          totalBounces++;
          events.push({
            frame: f,
            kind: "wall",
            wall: "top",
            x: b.x,
            y: WALL_CASCADE_BOUNDS.top,
            orbIndex: i,
            speed: Math.hypot(b.vx, b.vy),
          });
        } else if (b.y + b.r >= WALL_CASCADE_BOUNDS.bottom) {
          b.y = WALL_CASCADE_BOUNDS.bottom - b.r;
          b.vy = -Math.abs(b.vy);
          wallEnergy.bottom = 1;
          totalBounces++;
          events.push({
            frame: f,
            kind: "wall",
            wall: "bottom",
            x: b.x,
            y: WALL_CASCADE_BOUNDS.bottom,
            orbIndex: i,
            speed: Math.hypot(b.vx, b.vy),
          });
        }

        minXReached = Math.min(minXReached, b.x - b.r);
        maxXReached = Math.max(maxXReached, b.x + b.r);
        minYReached = Math.min(minYReached, b.y - b.r);
        maxYReached = Math.max(maxYReached, b.y + b.r);
      }

      // Elastic equal-density orb-orb collisions
      for (let i = 0; i < orbs.length; i++) {
        for (let j = i + 1; j < orbs.length; j++) {
          const a = orbs[i];
          const b = orbs[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = a.r + b.r;
          if (dist > 0 && dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = (minDist - dist) * 0.502;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              a.vx += vn * nx;
              a.vy += vn * ny;
              b.vx -= vn * nx;
              b.vy -= vn * ny;
            }
          }
        }
      }

      // String pluck crossings + mild transverse impulse
      for (let i = 0; i < orbs.length; i++) {
        const b = orbs[i];
        for (let sIdx = 0; sIdx < HARMONIC_STRINGS.length; sIdx++) {
          const str = HARMONIC_STRINGS[sIdx];
          const { dist, u } = signedSegmentDistance(b.x, b.y, str);
          const sign = dist >= 0 ? 1 : -1;
          if (
            sign !== lastSign[i][sIdx] &&
            u >= 0.02 &&
            u <= 0.98 &&
            Math.abs(dist) <= b.r * 1.5 &&
            f - cooldown[i][sIdx] >= 8
          ) {
            cooldown[i][sIdx] = f;
            stringState[sIdx].amp = 1.0;
            stringState[sIdx].phase = 0;
            stringState[sIdx].u = u;
            totalPlucks++;
            events.push({
              frame: f,
              kind: "string",
              stringIndex: sIdx,
              x: b.x,
              y: b.y,
              orbIndex: i,
              speed: Math.hypot(b.vx, b.vy),
            });
          }
          lastSign[i][sIdx] = sign;
        }
      }

      // Maintain healthy speed band [700, 1020] px/s
      for (const b of orbs) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < 700) {
          const k = 700 / Math.max(1, sp);
          b.vx *= k;
          b.vy *= k;
        } else if (sp > 1020) {
          const k = 1020 / sp;
          b.vx *= k;
          b.vy *= k;
        }
      }
    }

    // Per-frame decay for wall rails and transverse string standing waves
    wallEnergy.left *= 0.86;
    wallEnergy.right *= 0.86;
    wallEnergy.top *= 0.86;
    wallEnergy.bottom *= 0.86;
    for (let sIdx = 0; sIdx < stringState.length; sIdx++) {
      stringState[sIdx].amp *= 0.91;
      stringState[sIdx].phase += 0.85 + sIdx * 0.08;
    }

    frames.push({
      orbs: orbs.map((o) => ({ ...o })),
      wallEnergy: { ...wallEnergy },
      stringPlucks: stringState.map((s) => ({ ...s })),
      totalPlucks,
      totalBounces,
    });
  }

  cachedCascadeFeatures = null;
  cachedCascadeAudio = null;
  cachedCascadeTrace = {
    seed,
    frames,
    events,
    minXReached,
    maxXReached,
    minYReached,
    maxYReached,
  };
  return cachedCascadeTrace;
}

export function buildWallCascadeFeatures(
  trace = simulateWallCascade(),
): { buffer: StereoBuffer; features: FrameAudioFeatures[] } {
  if (cachedCascadeFeatures && trace === cachedCascadeTrace) return cachedCascadeFeatures;

  const buf = createStereoBuffer(WALL_CASCADE_TOTAL_FRAMES, VIDEO.fps);
  const totalSec = WALL_CASCADE_TOTAL_FRAMES / VIDEO.fps;

  // Continuous warm D-minor-9th stereo harmonic bed across the full 15s (steady through closing card)
  const chordLadder = [
    [146.832, 220.0, 261.626, 329.628, 440.0],
    [116.541, 174.614, 220.0, 293.665, 391.995],
    [130.813, 195.998, 261.626, 329.628, 493.883],
  ] as const;

  for (let seg = 0; seg < 5; seg++) {
    const startSec = seg * 3.0;
    const dur = Math.min(3.15, totalSec - startSec);
    addPadChord(buf, {
      startSec,
      durationSec: dur,
      frequencies: chordLadder[seg % chordLadder.length],
      gain: 0.17,
      stereoSpread: 0.75,
    });
  }

  // Gentle rhythmic sub pulse every 0.5s so the acoustic chamber has a grounded heartbeat
  for (let beat = 0; beat < 30; beat++) {
    const sec = beat * 0.5;
    addKick(buf, {
      startSec: sec,
      gain: sec < 12.0 ? 0.34 : 0.26,
      startHz: 135,
      endHz: 52,
      durationSec: 0.28,
    });
    if (beat % 2 === 0) {
      addBassNote(buf, {
        startSec: sec,
        durationSec: 0.44,
        frequency: beat % 8 < 4 ? 73.416 : 65.406,
        gain: 0.22,
        brightness: 0.8,
      });
    }
  }

  // Rate-limit dense simultaneous plucks/bounces per frame so polyphony stays lush and crystal clear
  let lastStringAudioFrame = -2;
  let lastWallAudioFrame = -3;
  const wallBassHz: Record<WallSide, number> = {
    left: 146.832,  // D3
    right: 220.0,   // A3
    top: 261.626,   // C4
    bottom: 110.0,  // A2
  };

  for (const ev of trace.events) {
    const sec = ev.frame / VIDEO.fps;
    const pan = panFromScreenX(ev.x, VIDEO.width, 0.85);
    if (ev.kind === "string" && ev.stringIndex !== undefined) {
      if (ev.frame - lastStringAudioFrame >= 2) {
        lastStringAudioFrame = ev.frame;
        const str = HARMONIC_STRINGS[ev.stringIndex];
        addPluck(buf, {
          startSec: sec,
          durationSec: 0.42,
          frequency: str.frequency,
          gain: 0.21,
          pan,
          fmIndex: 1.75,
        });
      }
    } else if (ev.kind === "wall" && ev.wall) {
      if (ev.frame - lastWallAudioFrame >= 4) {
        lastWallAudioFrame = ev.frame;
        addPluck(buf, {
          startSec: sec,
          durationSec: 0.26,
          frequency: wallBassHz[ev.wall] * 2,
          gain: 0.13,
          pan,
          fmIndex: 1.1,
        });
      }
    }
  }

  // Closing harmonic chime at t = 12.0s
  for (const [idx, freq] of [293.665, 349.228, 440.0, 523.251, 659.255].entries()) {
    addPluck(buf, {
      startSec: 12.02 + idx * 0.075,
      durationSec: 1.1,
      frequency: freq,
      gain: 0.18,
      pan: (idx - 2) * 0.32,
      fmIndex: 1.3,
    });
  }

  calibrateStereoMaster(buf, { targetLufs: -14.0, ceilingDbTp: -1.8 });
  const features = extractFrameAudioFeatures(buf.left, buf.right, VIDEO.fps);
  const out = { buffer: buf, features };
  if (trace === cachedCascadeTrace) cachedCascadeFeatures = out;
  return out;
}

export function buildWallCascadeAudio(
  trace = simulateWallCascade(),
): { buffer: StereoBuffer; wav: Uint8Array; features: FrameAudioFeatures[] } {
  if (cachedCascadeAudio && trace === cachedCascadeTrace) return cachedCascadeAudio;
  const { buffer, features } = buildWallCascadeFeatures(trace);
  const wav = encodeStereoPcm16Wav(buffer.left, buffer.right);
  const out = { buffer, wav, features };
  if (trace === cachedCascadeTrace) cachedCascadeAudio = out;
  return out;
}

export function paintWallCascadeFrame(
  ctx: CanvasRenderingContext2D,
  trace: WallCascadeTrace,
  features: readonly FrameAudioFeatures[],
  frame: number,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  const clampedFrame = Math.max(0, Math.min(trace.frames.length - 1, frame));
  const state = trace.frames[clampedFrame];
  const feat = features[Math.min(features.length - 1, clampedFrame)];
  const sec = clampedFrame / VIDEO.fps;

  // 1. Full-bleed 1080x1920 rich dark acoustic chamber gradient (zero black margins)
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.colors.gpuHud.wallBackgroundTop);
  bg.addColorStop(0.5, theme.colors.gpuHud.wallBackgroundMid);
  bg.addColorStop(1, theme.colors.gpuHud.wallBackgroundBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 2. Full-screen 0..1080 x 0..1920 acoustic wave-interference lattice
  const recentPulses = trace.events.filter(
    (ev) => ev.frame <= clampedFrame && clampedFrame - ev.frame <= 36,
  );
  const cell = 54;
  for (let gx = cell / 2; gx < width; gx += cell) {
    for (let gy = cell / 2; gy < height; gy += cell) {
      let wave = Math.sin(gx * 0.012 + sec * 2.4) * Math.cos(gy * 0.012 - sec * 1.9) * 0.35;
      for (let p = recentPulses.length - 1; p >= Math.max(0, recentPulses.length - 6); p--) {
        const ev = recentPulses[p];
        const age = (clampedFrame - ev.frame) / VIDEO.fps;
        const r = age * 920;
        const d = Math.hypot(gx - ev.x, gy - ev.y);
        wave += Math.exp(-Math.abs(d - r) * 0.032) * Math.max(0, 1 - age * 1.6);
      }
      const intensity = Math.min(1, Math.max(0.08, 0.14 + wave * 0.42 + feat.kickImpulse * 0.18));
      ctx.fillStyle = colorWithAlpha(theme.colors.gpuHud.accentRgb, intensity * 0.36);
      const dotR = 2.2 + intensity * 3.8;
      ctx.beginPath();
      ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Expanding full-screen shockwave rings from recent string & wall impacts
  for (let p = Math.max(0, recentPulses.length - 12); p < recentPulses.length; p++) {
    const ev = recentPulses[p];
    const ageFrames = clampedFrame - ev.frame;
    const progress = ageFrames / 36;
    const radius = 18 + progress * 460;
    const alpha = (1 - progress) * (ev.kind === "string" ? 0.52 : 0.38);
    ctx.strokeStyle =
      ev.kind === "string" && ev.stringIndex !== undefined
        ? HARMONIC_STRINGS[ev.stringIndex].color
        : theme.colors.gpuHud.cyan;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.lineWidth = ev.kind === "string" ? 3.2 : 2.4;
    ctx.beginPath();
    ctx.arc(ev.x, ev.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 4. Full-span vibrating harmonic harp strings anchored edge-to-edge on x=0..1080
  for (let sIdx = 0; sIdx < HARMONIC_STRINGS.length; sIdx++) {
    const str = HARMONIC_STRINGS[sIdx];
    const pluck = state.stringPlucks[sIdx];
    const dx = str.bx - str.ax;
    const dy = str.by - str.ay;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const deflection = Math.sin(pluck.phase) * pluck.amp * 34;
    const midX = str.ax + dx * pluck.u + nx * deflection;
    const midY = str.ay + dy * pluck.u + ny * deflection;

    ctx.save();
    ctx.strokeStyle = str.color;
    ctx.shadowColor = str.color;
    ctx.shadowBlur = 10 + pluck.amp * 24;
    ctx.globalAlpha = 0.52 + Math.min(0.48, pluck.amp * 0.65);
    ctx.lineWidth = 2.6 + pluck.amp * 3.8;
    ctx.beginPath();
    ctx.moveTo(str.ax, str.ay);
    ctx.quadraticCurveTo(midX, midY, str.bx, str.by);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Orb motion wakes + glowing harmonic orbs across 0..1080 x 0..1920
  const trailSteps = 7;
  for (let oIdx = 0; oIdx < state.orbs.length; oIdx++) {
    ctx.beginPath();
    for (let tBack = trailSteps; tBack >= 0; tBack--) {
      const histFrame = Math.max(0, clampedFrame - tBack * 2);
      const pos = trace.frames[histFrame].orbs[oIdx];
      if (tBack === trailSteps) ctx.moveTo(pos.x, pos.y);
      else ctx.lineTo(pos.x, pos.y);
    }
    const orb = state.orbs[oIdx];
    ctx.strokeStyle = orb.color;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = orb.r * 0.95;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.shadowColor = orb.color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = orb.color;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.colors.gpuHud.white;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.arc(orb.x - orb.r * 0.24, orb.y - orb.r * 0.24, orb.r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 6. Glowing true-edge perimeter energy rails at x=0, x=1080, y=0, y=1920
  const railThickness = 10;
  ctx.fillStyle = colorWithAlpha(theme.colors.gpuHud.cyanRgb, 0.32 + 0.68 * state.wallEnergy.left);
  ctx.fillRect(0, 0, railThickness, height);
  ctx.fillStyle = colorWithAlpha(theme.colors.gpuHud.limeRgb, 0.32 + 0.68 * state.wallEnergy.right);
  ctx.fillRect(width - railThickness, 0, railThickness, height);
  ctx.fillStyle = colorWithAlpha(theme.colors.gpuHud.pinkRgb, 0.32 + 0.68 * state.wallEnergy.top);
  ctx.fillRect(0, 0, width, railThickness);
  ctx.fillStyle = colorWithAlpha(theme.colors.gpuHud.tealRgb, 0.32 + 0.68 * state.wallEnergy.bottom);
  ctx.fillRect(0, height - railThickness, width, railThickness);

  // 7. Reel-safe HUD cards (strictly inside x: 60..900, y: 220..1560)
  const boxes: ReelBox[] = [];
  const topCard: ReelBox = {
    label: "cascade-header-card",
    left: 68,
    top: 232,
    right: 710,
    bottom: 342,
  };
  assertReelSafeBox(topCard);

  ctx.save();
  ctx.fillStyle = theme.colors.gpuHud.wallTopCard;
  ctx.strokeStyle = theme.colors.gpuHud.wallTopBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(topCard.left, topCard.top, topCard.right - topCard.left, topCard.bottom - topCard.top, 18);
  ctx.fill();
  ctx.stroke();

  drawReelText(ctx, boxes, "POLYPHONIC WALL CASCADE", 92, 280, {
    size: 30,
    weight: 800,
    color: theme.colors.gpuHud.ink,
    maxWidth: 590,
  });
  drawReelText(ctx, boxes, "8 HARMONIC STRINGS · STEREO PANNED", 92, 320, {
    size: 20,
    weight: 600,
    color: theme.colors.primary,
    maxWidth: 590,
  });

  const bottomCard: ReelBox = {
    label: "cascade-telemetry-card",
    left: 68,
    top: 1452,
    right: 884,
    bottom: 1546,
  };
  assertReelSafeBox(bottomCard);

  ctx.fillStyle = theme.colors.gpuHud.wallBottomCard;
  ctx.strokeStyle = theme.colors.gpuHud.wallBottomBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(
    bottomCard.left,
    bottomCard.top,
    bottomCard.right - bottomCard.left,
    bottomCard.bottom - bottomCard.top,
    16,
  );
  ctx.fill();
  ctx.stroke();

  drawReelText(
    ctx,
    boxes,
    `CHORD PLUCKS ${state.totalPlucks}   ·   EDGE IMPACTS ${state.totalBounces}`,
    92,
    1508,
    {
      size: 23,
      weight: 700,
      color: theme.colors.ink,
      maxWidth: 760,
    },
  );
  ctx.restore();

  return boxes;
}
