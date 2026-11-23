import {
  addBassNote,
  addHiHat,
  addKick,
  addPadChord,
  addPluck,
  addSnare,
  calibrateStereoMaster,
  createStereoBuffer,
  encodeStereoPcm16Wav,
  extractFrameAudioFeatures,
  SPECTRUM_BIN_COUNT,
  type FrameAudioFeatures,
  type StereoBuffer,
} from "../audio-reactive/synth.ts";
import { CLOSING_FRAMES, SCENE_FRAMES, TOTAL_FRAMES, VIDEO } from "../settings.ts";
import { assertReelSafeBox, drawReelText, type ReelBox } from "../shared/reelUtils.ts";

export const CYBER_TUNNEL_BPM = 124;
export const CYBER_TUNNEL_SCENE_FRAMES = SCENE_FRAMES; // 720 (12s)
export const CYBER_TUNNEL_CLOSING_FRAMES = CLOSING_FRAMES; // 180 (3s)
export const CYBER_TUNNEL_TOTAL_FRAMES = TOTAL_FRAMES; // 900 (15s)

export const CYBER_TUNNEL_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const CYBER_TUNNEL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_kick;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_rms;
uniform float u_spectrum[32];

mat2 rot2d(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sampleSpectrum(float normAngle) {
  float idx = clamp(normAngle, 0.0, 0.9999) * 31.0;
  int i0 = int(floor(idx));
  int i1 = min(31, i0 + 1);
  float frac = fract(idx);
  return mix(u_spectrum[i0], u_spectrum[i1], frac);
}

// Octagonal ribbed synthwave corridor distance field
float tunnelRadius(vec3 p) {
  float twist = sin(p.z * 0.14 - u_time * 0.65) * 0.42 + u_time * 0.22;
  vec2 q = rot2d(twist) * p.xy;
  float ang = atan(q.y, q.x);
  float symAng = abs(ang) / 3.14159265;
  float spec = sampleSpectrum(symAng);

  // Octagonal facet shaping so walls fill rectangular corners strongly
  vec2 aq = abs(q);
  float octMetric = max(max(aq.x, aq.y), (aq.x + aq.y) * 0.70710678);
  float euclidean = length(q) + 1e-4;
  float shapeScale = octMetric / euclidean;

  float ribWave = sin(p.z * 3.2 - u_time * 4.0) * 0.065;
  float specExtrude = spec * (0.24 + 0.16 * u_bass);
  float kickExpand = u_kick * 0.14;
  return (1.28 + ribWave + kickExpand - specExtrude) / shapeScale;
}

vec3 evalScene(vec2 uvCentered, float chromaShift) {
  // Subtle camera sway + FOV warp on kicks so every edge pixel stays alive
  vec2 camOffset = vec2(
    sin(u_time * 0.85) * 0.11,
    cos(u_time * 0.68) * 0.09
  );
  float fov = 1.08 - u_kick * 0.10 + chromaShift;
  vec3 ro = vec3(camOffset, u_time * 5.2);
  vec3 rd = normalize(vec3(uvCentered * fov, 1.0));
  rd.xy = rot2d(sin(u_time * 0.35) * 0.12) * rd.xy;

  float t = 0.0;
  vec3 accumGlow = vec3(0.0);
  float hitDist = 28.0;
  vec3 hitPos = ro + rd * hitDist;

  for (int stepIdx = 0; stepIdx < 56; stepIdx++) {
    vec3 p = ro + rd * t;
    float wallR = tunnelRadius(p);
    float d = wallR - length(p.xy);

    // Volumetric neon rib & beat-pulse glow along the ray
    float zCell = abs(fract(p.z * 0.75) - 0.5);
    float ringGlow = exp(-zCell * 22.0);
    float pulseFront = fract(p.z * 0.08 - u_time * 1.45);
    float kickWave = exp(-abs(pulseFront - 0.5) * 14.0) * (0.35 + 1.25 * u_kick);

    float angNorm = abs(atan(p.y, p.x)) / 3.14159265;
    float spec = sampleSpectrum(angNorm);

    vec3 cyan = vec3(0.14, 0.74, 0.98);
    vec3 lime = vec3(0.78, 1.00, 0.52);
    vec3 magenta = vec3(0.96, 0.34, 0.72);
    vec3 ribColor = mix(cyan, magenta, smoothstep(0.15, 0.85, angNorm));
    ribColor = mix(ribColor, lime, clamp(spec * 0.85 + u_high * 0.25, 0.0, 1.0));

    float nearWall = 1.0 / (1.0 + max(0.0, d) * max(0.0, d) * 26.0);
    accumGlow += ribColor * nearWall * (0.022 + 0.045 * ringGlow + 0.038 * kickWave);

    if (d < 0.012 || t > 28.0) {
      hitDist = t;
      hitPos = p;
      break;
    }
    t += max(0.055, d * 0.58);
  }

  // Crisp synthwave grid lines on the hit tunnel wall
  float twist = sin(hitPos.z * 0.14 - u_time * 0.65) * 0.42 + u_time * 0.22;
  vec2 wq = rot2d(twist) * hitPos.xy;
  float ang = atan(wq.y, wq.x);
  float uCoord = ang / 3.14159265 * 8.0;
  float vCoord = hitPos.z * 1.5;

  float gridU = smoothstep(0.09, 0.0, abs(fract(uCoord) - 0.5));
  float gridV = smoothstep(0.08, 0.0, abs(fract(vCoord) - 0.5));
  float specAtWall = sampleSpectrum(abs(ang) / 3.14159265);

  vec3 baseWall = vec3(0.04, 0.07, 0.14) + vec3(0.05, 0.11, 0.20) * (0.4 + 0.6 * u_rms);
  vec3 gridTint = mix(vec3(0.22, 0.76, 0.96), vec3(0.78, 1.0, 0.52), specAtWall);
  vec3 surface = baseWall + gridTint * (gridU * (0.45 + 0.75 * specAtWall) + gridV * (0.38 + 0.7 * u_kick));

  float fog = exp(-hitDist * 0.085);
  vec3 horizonCore = mix(vec3(0.12, 0.34, 0.62), vec3(0.92, 0.36, 0.68), 0.45 + 0.45 * sin(u_time * 0.9))
    * (0.55 + 0.65 * u_bass + 0.45 * u_kick);

  return mix(horizonCore, surface, fog) + accumGlow;
}

void main() {
  vec2 frag = v_uv * u_resolution;
  // Aspect-preserving full-screen coordinates covering the entire 1080x1920 frame
  vec2 uv = (frag - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  float radial = length(uv);
  float ca = (0.004 + 0.014 * u_kick) * smoothstep(0.15, 1.15, radial);

  float colR = evalScene(uv, ca).r;
  vec3 colMain = evalScene(uv, 0.0);
  float colB = evalScene(uv, -ca).b;
  vec3 color = vec3(colR, colMain.g, colB);

  // Subtle ACES-like filmic tone curve so highlights stay rich without flat clipping
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);

  // Micro scanline + deterministic film grain so zero pixels sit flat black
  float scan = 0.965 + 0.035 * sin(frag.y * 1.570796);
  float grain = (hash21(frag + fract(u_time) * 173.0) - 0.5) * 0.025;
  color = clamp(color * scan + grain + vec3(0.018, 0.024, 0.042), 0.02, 1.0);

  outColor = vec4(pow(color, vec3(0.92)), 1.0);
}
`;

export interface CyberTunnelFeatureBundle {
  buffer: StereoBuffer;
  features: FrameAudioFeatures[];
}

export interface CyberTunnelAudioBundle extends CyberTunnelFeatureBundle {
  wav: Uint8Array;
}

let cachedFeatures: CyberTunnelFeatureBundle | null = null;
let cachedBundle: CyberTunnelAudioBundle | null = null;

export function buildCyberTunnelFeatures(): CyberTunnelFeatureBundle {
  if (cachedFeatures) return cachedFeatures;

  const buf = createStereoBuffer(CYBER_TUNNEL_TOTAL_FRAMES, VIDEO.fps);
  const beatSec = 60 / CYBER_TUNNEL_BPM; // 0.483871 s
  const stepSec = beatSec / 4; // 16th note
  const totalSec = CYBER_TUNNEL_TOTAL_FRAMES / VIDEO.fps; // 15.0 s
  const sceneSec = CYBER_TUNNEL_SCENE_FRAMES / VIDEO.fps; // 12.0 s

  // 4-chord dark synthwave progression: Dm9 -> BbMaj7#11 -> FMaj9 -> Cadd9
  const progression = [
    { root: 73.416, chord: [146.832, 220.0, 261.626, 329.628, 440.0] },
    { root: 58.27, chord: [116.541, 174.614, 220.0, 261.626, 391.995] },
    { root: 87.307, chord: [174.614, 261.626, 329.628, 391.995, 523.251] },
    { root: 65.406, chord: [130.813, 195.998, 293.665, 329.628, 391.995] },
  ] as const;

  const barSec = beatSec * 4;
  const barCount = Math.ceil(totalSec / barSec);

  for (let bar = 0; bar < barCount; bar++) {
    const startSec = bar * barSec;
    if (startSec >= totalSec) break;
    const dur = Math.min(barSec + 0.08, totalSec - startSec);
    const harm = progression[bar % progression.length];
    addPadChord(buf, {
      startSec,
      durationSec: dur,
      frequencies: harm.chord,
      gain: startSec < sceneSec ? 0.16 : 0.19,
      stereoSpread: 0.72,
    });
  }

  // Drums, rolling octave bass, and stereo-panned 16th-note arpeggio
  const totalSteps = Math.floor(totalSec / stepSec);
  const arpOffsets = [0, 2, 4, 3, 1, 4, 2, 3];

  for (let step = 0; step < totalSteps; step++) {
    const sec = step * stepSec;
    const inClosing = sec >= sceneSec;
    const barIdx = Math.floor(sec / barSec);
    const harm = progression[barIdx % progression.length];
    const stepInBeat = step % 4;
    const beatInBar = Math.floor((step % 16) / 4);

    if (!inClosing) {
      // Four-on-the-floor kick + syncopated turnaround kick
      if (stepInBeat === 0 || (beatInBar === 3 && stepInBeat === 3 && barIdx % 2 === 1)) {
        addKick(buf, { startSec: sec, gain: 0.56, startHz: 168, endHz: 54 });
      }
      // Backbeat snare on beats 2 & 4
      if ((beatInBar === 1 || beatInBar === 3) && stepInBeat === 0) {
        addSnare(buf, { startSec: sec, gain: 0.27, seed: 900 + step });
      }
      // Crisp stereo 16th hats (louder on offbeats)
      addHiHat(buf, {
        startSec: sec,
        durationSec: stepInBeat === 2 ? 0.11 : 0.055,
        gain: stepInBeat === 2 ? 0.15 : 0.075,
        pan: (step % 2 === 0 ? -1 : 1) * 0.38,
        seed: 2400 + step,
      });

      // Rolling 8th-note octave synthwave bass
      if (step % 2 === 0) {
        const octaveMult = step % 4 === 2 ? 2 : 1;
        addBassNote(buf, {
          startSec: sec,
          durationSec: stepSec * 1.85,
          frequency: harm.root * octaveMult,
          gain: 0.3,
          brightness: step % 4 === 2 ? 1.25 : 0.9,
        });
      }

      // Stereo-panned 16th-note synthwave arpeggio
      const noteFreq = harm.chord[arpOffsets[step % arpOffsets.length]] * (step % 8 === 7 ? 2 : 1);
      const pan = Math.sin(step * 0.65) * 0.76;
      addPluck(buf, {
        startSec: sec,
        durationSec: stepSec * 1.6,
        frequency: noteFreq,
        gain: 0.16,
        pan,
        fmIndex: 1.9,
      });
    } else {
      // Steady closing groove bed during the 3s end card (no dead silence)
      if (stepInBeat === 0 && beatInBar % 2 === 0) {
        addKick(buf, { startSec: sec, gain: 0.38, startHz: 145, endHz: 54 });
      }
      if (step % 4 === 0) {
        addBassNote(buf, {
          startSec: sec,
          durationSec: stepSec * 3.6,
          frequency: progression[0].root,
          gain: 0.24,
          brightness: 0.75,
        });
        const idx = (step / 4) % progression[0].chord.length;
        addPluck(buf, {
          startSec: sec,
          durationSec: 0.55,
          frequency: progression[0].chord[idx] * 2,
          gain: 0.14,
          pan: ((idx % 3) - 1) * 0.55,
          fmIndex: 1.2,
        });
      }
    }
  }

  calibrateStereoMaster(buf, { targetLufs: -14.0, ceilingDbTp: -1.8 });
  const features = extractFrameAudioFeatures(buf.left, buf.right, VIDEO.fps);
  cachedFeatures = { buffer: buf, features };
  return cachedFeatures;
}

export function buildCyberTunnelAudio(): CyberTunnelAudioBundle {
  if (cachedBundle) return cachedBundle;
  const { buffer, features } = buildCyberTunnelFeatures();
  const wav = encodeStereoPcm16Wav(buffer.left, buffer.right);
  cachedBundle = { buffer, wav, features };
  return cachedBundle;
}

export interface CyberTunnelGlRenderer {
  renderFrame: (frame: number, fps: number, feature: FrameAudioFeatures) => void;
  dispose: () => void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate WebGL2 shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "Unknown GLSL compile error";
    gl.deleteShader(shader);
    throw new Error(`GLSL compile failed: ${info}`);
  }
  return shader;
}

export function createCyberTunnelGlRenderer(canvas: HTMLCanvasElement): CyberTunnelGlRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, CYBER_TUNNEL_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, CYBER_TUNNEL_FRAGMENT_SHADER);
  const prog = gl.createProgram();
  if (!prog) throw new Error("Unable to allocate WebGL2 program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? "Unknown GLSL link error";
    gl.deleteProgram(prog);
    throw new Error(`GLSL program link failed: ${info}`);
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const posLoc = gl.getAttribLocation(prog, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_resolution");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uKick = gl.getUniformLocation(prog, "u_kick");
  const uBass = gl.getUniformLocation(prog, "u_bass");
  const uMid = gl.getUniformLocation(prog, "u_mid");
  const uHigh = gl.getUniformLocation(prog, "u_high");
  const uRms = gl.getUniformLocation(prog, "u_rms");
  const uSpec = gl.getUniformLocation(prog, "u_spectrum[0]");

  return {
    renderFrame(frame: number, fps: number, feature: FrameAudioFeatures) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, frame / fps);
      gl.uniform1f(uKick, feature.kickImpulse);
      gl.uniform1f(uBass, feature.bass);
      gl.uniform1f(uMid, feature.mid);
      gl.uniform1f(uHigh, feature.high);
      gl.uniform1f(uRms, feature.rms);
      gl.uniform1fv(uSpec, feature.spectrumBins);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.flush();
    },
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

/**
 * Full-bleed 1080x1920 deterministic 2D tunnel fallback when WebGL2 is unavailable (e.g. headless mock tests).
 */
export function paintCyberTunnelFallback2D(
  ctx: CanvasRenderingContext2D,
  frame: number,
  feature: FrameAudioFeatures,
  width = VIDEO.width,
  height = VIDEO.height,
): void {
  const sec = frame / VIDEO.fps;
  const cx = width * 0.5 + Math.sin(sec * 0.85) * 42;
  const cy = height * 0.5 + Math.cos(sec * 0.68) * 58;
  const bg = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.hypot(width, height) * 0.65);
  bg.addColorStop(0, `rgb(${Math.round(45 + 140 * feature.kickImpulse)}, ${Math.round(70 + 80 * feature.bass)}, 165)`);
  bg.addColorStop(0.5, "#0d1a33");
  bg.addColorStop(1, "#070d1c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Perspective octagonal rings expanding past all 4 corners of the 1080x1920 frame
  const ringCount = 26;
  const phase = (sec * 3.6) % 1;
  for (let i = 0; i < ringCount; i++) {
    const depth = (i + 1 - phase) / ringCount;
    const scale = 0.08 / Math.max(0.04, depth);
    const halfW = width * 0.62 * scale;
    const halfH = height * 0.62 * scale;
    const specVal = feature.spectrumBins[i % SPECTRUM_BIN_COUNT];
    const twist = Math.sin(sec * 0.6 + i * 0.22) * 0.16;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(twist);
    ctx.strokeStyle =
      i % 3 === 0
        ? `rgba(200, 255, 133, ${(0.22 + 0.65 * specVal).toFixed(3)})`
        : `rgba(56, 189, 248, ${(0.18 + 0.55 * (1 - depth)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.5, (1 - depth) * 5.5 + feature.kickImpulse * 2.5);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const rBoost = 1 + feature.spectrumBins[(k * 4) % 32] * 0.18;
      const px = Math.cos(a) * halfW * rBoost;
      const py = Math.sin(a) * halfH * rBoost;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Safe-zone HUD overlay (strictly inside x: 60..900, y: 220..1560).
 */
export function paintCyberTunnelHud(
  ctx: CanvasRenderingContext2D,
  frame: number,
  feature: FrameAudioFeatures,
  width = VIDEO.width,
  height = VIDEO.height,
): ReelBox[] {
  ctx.clearRect(0, 0, width, height);
  const boxes: ReelBox[] = [];

  // Top-left frosted HUD badge inside REEL_SAFE_BOUNDS
  const cardBox: ReelBox = {
    label: "cyber-header-card",
    left: 68,
    top: 232,
    right: 680,
    bottom: 342,
  };
  assertReelSafeBox(cardBox);

  ctx.save();
  ctx.fillStyle = "rgba(8, 13, 24, 0.72)";
  ctx.strokeStyle = `rgba(200, 255, 133, ${(0.35 + 0.45 * feature.kickImpulse).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cardBox.left, cardBox.top, cardBox.right - cardBox.left, cardBox.bottom - cardBox.top, 18);
  ctx.fill();
  ctx.stroke();

  drawReelText(ctx, boxes, "CYBER SYNTH TUNNEL", 92, 280, {
    size: 32,
    weight: 800,
    color: "#f8fafc",
    maxWidth: 560,
  });
  drawReelText(
    ctx,
    boxes,
    `${CYBER_TUNNEL_BPM} BPM · WEBGL2 GLSL · 48 KHZ STEREO`,
    92,
    320,
    {
      size: 20,
      weight: 600,
      color: "#c8ff85",
      maxWidth: 560,
    },
  );

  // Bottom safe-zone live 32-band spectrum telemetry strip (y: 1435..1542 <= 1560, x: 68..884 <= 900)
  const eqBox: ReelBox = {
    label: "cyber-eq-strip",
    left: 68,
    top: 1432,
    right: 884,
    bottom: 1546,
  };
  assertReelSafeBox(eqBox);

  ctx.fillStyle = "rgba(8, 13, 24, 0.68)";
  ctx.strokeStyle = "rgba(116, 185, 209, 0.34)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(eqBox.left, eqBox.top, eqBox.right - eqBox.left, eqBox.bottom - eqBox.top, 16);
  ctx.fill();
  ctx.stroke();

  const barAreaLeft = 88;
  const barAreaWidth = 540;
  const barStep = barAreaWidth / SPECTRUM_BIN_COUNT;
  const barBottom = 1528;
  const maxBarH = 62;

  for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
    const val = feature.spectrumBins[b];
    const bh = Math.max(4, val * maxBarH);
    const bx = barAreaLeft + b * barStep;
    ctx.fillStyle = b < 8 ? "#c8ff85" : b < 20 ? "#38bdf8" : "#f472b6";
    ctx.fillRect(bx, barBottom - bh, Math.max(4, barStep - 4), bh);
  }

  const beatNum = (Math.floor((frame / VIDEO.fps) * (CYBER_TUNNEL_BPM / 60)) % 4) + 1;
  drawReelText(ctx, boxes, `BEAT ${beatNum}/4`, 654, 1480, {
    size: 22,
    weight: 700,
    color: "#f8fafc",
    maxWidth: 210,
  });
  drawReelText(
    ctx,
    boxes,
    `KICK ${Math.round(feature.kickImpulse * 100)}%`,
    654,
    1518,
    {
      size: 20,
      weight: 600,
      color: "#74b9d1",
      maxWidth: 210,
    },
  );

  ctx.restore();
  return boxes;
}
