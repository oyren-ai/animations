import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accentPulse, cameraKick, FRAME_CENTER_X, hash01 } from "../midi/kit.ts";
import { parseMidi } from "../midi/parse.ts";
import { barSeconds, buildSceneData, pieceTime, type MidiSceneData } from "../midi/timeline.ts";
import type { MidiNote, ParsedMidi } from "../midi/types.ts";
import {
  angleDiff, arcState, barPulse, breathing, buildOrbit, buildRingMap, cameraZoom, climaxEnvelope, discRotation, DISC, LEGEND, legendLayout,
  MAX_ARCS, maxArcExtent, onsetFrame, orbitPeriod, PALETTE, pickVisible, playheadAngle, shockwave, strikeGlowDiameter, TAU, TICK_MAX,
  TIMELINE, visibleRange, WINDOW_AHEAD, WINDOW_BEHIND, wrapAngle,
} from "./layout.ts";
import { createOrbitPainter } from "./paint.ts";
import { DUST_COUNT, dustAt, SPARK_MAX_LIFE, sparkAt, type DustPoint, type SparkPoint } from "./particles.ts";

const FILES = ["pentatonic-phase.mid", "ode-to-joy.mid", "canon-in-d.mid"];
const TIMING = { fps: 60, leadFrames: 66, tailSec: 3 };
const SIZE = { width: 1080, height: 1920 };

function sceneOf(parsed: ParsedMidi, name = "test.mid"): MidiSceneData {
  return buildSceneData(parsed, name, TIMING, SIZE);
}
function loadScene(file: string): MidiSceneData {
  return sceneOf(parseMidi(new Uint8Array(readFileSync(new URL("../../public/midi/" + file, import.meta.url)))), file);
}
function synthetic(notes: MidiNote[], numerator = 4, denominator = 4): MidiSceneData {
  const end = notes.reduce((max, n) => Math.max(max, n.timeSec + n.durationSec), 0);
  const tracks = [...new Set(notes.map((n) => n.track))].sort((a, b) => a - b).map((index) => ({
    index, name: "Track " + index, programs: [], channels: [0], noteCount: notes.filter((n) => n.track === index).length,
  }));
  return sceneOf({
    format: 1, ticksPerQuarter: 480, tempoMap: [{ tick: 0, timeSec: 0, microsecondsPerQuarter: 500000 }],
    timeSignature: { numerator, denominator }, tracks, notes: [...notes].sort((a, b) => a.timeSec - b.timeSec), durationSec: end,
  });
}
const note = (timeSec: number, pitch: number, track = 1, durationSec = 0.2, velocity = 80): MidiNote =>
  ({ timeSec, durationSec, pitch, velocity, track, channel: track });

const PHASE = loadScene("pentatonic-phase.mid");
const PHASE_MODEL = buildOrbit(PHASE);
const near = (actual: number, expected: number, epsilon: number, message = "") =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message} ${actual} vs ${expected} (+/- ${epsilon})`);

test("Pentatonic Phase: one visual event per note, in order, with a 3 s revolution", () => {
  assert.equal(PHASE_MODEL.events.length, PHASE.notes.length);
  assert.ok(PHASE.notes.length > 400);
  PHASE_MODEL.events.forEach((ev, i) => {
    const n = PHASE.notes[i];
    assert.equal(ev.index, i);
    assert.equal(ev.timeSec, n.timeSec);
    assert.equal(ev.pitch, n.pitch);
    assert.equal(ev.track, n.track);
  });
  near(PHASE_MODEL.period, 3, 1e-9);
  assert.equal(PHASE_MODEL.period, barSeconds(PHASE));
  assert.equal(PHASE_MODEL.trackCount, 4);
  for (const file of FILES) {
    const scene = loadScene(file);
    assert.equal(buildOrbit(scene).events.length, scene.notes.length, file);
  }
});

test("a note's arc angle is 2 pi (time mod P) / P measured from tick 0", () => {
  const P = 3;
  for (const ev of PHASE_MODEL.events) {
    const expected = 2 * Math.PI * (ev.timeSec % P) / P;
    near(Math.abs(angleDiff(ev.angle, expected)), 0, 1e-9, `note ${ev.index}`);
    assert.ok(ev.angle >= 0 && ev.angle < TAU);
    assert.ok(ev.length > 0 && ev.length <= TAU);
  }
  // file without a time signature falls back to 4/4 at the first tempo: 2 s at 120 BPM
  const plain = synthetic([note(0, 60), note(2, 62), note(3, 64)]);
  near(orbitPeriod(plain), 2, 1e-9);
  near(buildOrbit(plain).events[1].angle, 0, 1e-9);
  near(buildOrbit(plain).events[2].angle, Math.PI, 1e-9);
  near(orbitPeriod(synthetic([note(0, 60)], 6, 4)), 3, 1e-9);
});

test("the playhead crosses voice A's notes at their onset, and the flash starts on that frame", () => {
  const P = PHASE_MODEL.period;
  const voiceA = PHASE_MODEL.events.filter((ev) => ev.track === 1);
  assert.ok(voiceA.length > 150);
  const framePhase = TAU / P / PHASE.fps; // radians the playhead moves per video frame
  for (const ev of voiceA) {
    near(Math.abs(angleDiff(playheadAngle(ev.timeSec, P), ev.angle)), 0, 1e-9, `crossing of note ${ev.index}`);
    const frame = onsetFrame(PHASE, ev.timeSec);
    assert.ok(pieceTime(PHASE, frame) >= ev.timeSec && pieceTime(PHASE, frame - 1) < ev.timeSec);
    const ahead = angleDiff(playheadAngle(pieceTime(PHASE, frame), P), ev.angle);
    assert.ok(ahead >= -1e-9 && ahead < framePhase + 1e-9, `playhead is within one frame of note ${ev.index}: ${ahead}`);
    const before = arcState(ev, pieceTime(PHASE, frame - 1), P);
    const onset = arcState(ev, pieceTime(PHASE, frame), P);
    assert.equal(before.flash, 0);
    assert.ok(before.age < 0 && before.lit === 0);
    assert.ok(onset.age >= 0 && onset.flash > Math.exp(-1 / 6) - 1e-9, "white-hot on the very first frame");
    assert.ok(onset.alpha > 0.9, "struck arc is bright");
  }
});

test("voice B drifts against voice A and everything realigns at 45 s", () => {
  const events = PHASE_MODEL.events;
  const start = (track: number, pitch: number, at: number, tolerance = 0.02) =>
    events.find((ev) => ev.track === track && ev.pitch === pitch && Math.abs(ev.timeSec - at) < tolerance);
  // unison entrance at 6 s and the full realignment at 45 s (all three loop starts: E4, E4, bell B5)
  const a6 = start(1, 64, 6)!, b6 = start(2, 64, 6)!;
  near(Math.abs(angleDiff(a6.angle, b6.angle)), 0, 0.02, "unison entrance");
  const a45 = start(1, 64, 45)!, b45 = start(2, 64, 45)!, c45 = start(3, 83, 45)!;
  assert.ok(a45 && b45 && c45, "all three voices restart together at 45 s");
  near(Math.abs(angleDiff(a45.angle, b45.angle)), 0, 0.02, "A vs B at 45 s");
  near(Math.abs(angleDiff(a45.angle, c45.angle)), 0, 0.02, "A vs C at 45 s");
  // at 25 s B's loop start (25.5 s) sits half a revolution away from A's loop start
  const a24 = start(1, 64, 24)!, b25 = start(2, 64, 25.5)!;
  assert.ok(Math.abs(angleDiff(a24.angle, b25.angle)) > 2.5, "B has slid about half a turn away from A");
  // each B loop starts earlier on the disc by 2 pi (3 - 156/14/4) / 3 radians
  const bLoops = events.filter((ev) => ev.track === 2 && ev.pitch === 64 && ev.timeSec > 5.9 && ev.timeSec < 45.1);
  assert.ok(bLoops.length >= 14);
  const drift = TAU * (3 - (156 / 14) * 0.25) / 3;
  for (let i = 1; i < bLoops.length; i++) near(angleDiff(bLoops[i - 1].angle, bLoops[i].angle), drift, 0.012, `B loop ${i}`);
  // the realignment is a strong coincidence, and so is the entrance
  const at45 = PHASE_MODEL.coincidences.find((c) => Math.abs(c.timeSec - 45) < 0.02)!;
  assert.ok(at45 && at45.unison && at45.voices === 4 && at45.strength >= 0.99);
  const at6 = PHASE_MODEL.coincidences.find((c) => Math.abs(c.timeSec - 6) < 0.02)!;
  assert.ok(at6 && at6.unison && at6.strength >= 0.65);
});

test("the final chord is the climax; ordinary bars are not", () => {
  const climax = PHASE_MODEL.climax!;
  assert.ok(climax, "a climax is found");
  near(climax.timeSec, 48, 0.01);
  assert.ok(climax.noteCount >= 6 && climax.strength > 0.9);
  const flagged = PHASE_MODEL.events.filter((ev) => ev.climax);
  assert.equal(flagged.length, climax.noteCount);
  assert.ok(flagged.every((ev) => ev.timeSec >= 47.99));
  assert.ok(PHASE_MODEL.events.filter((ev) => ev.timeSec < 47.9).every((ev) => !ev.climax));
});

test("rings: rank-based and evenly spaced up to 24 pitches, linear in pitch beyond", () => {
  const ranked = PHASE_MODEL.ringMap;
  assert.equal(ranked.ranked, true);
  assert.equal(ranked.pitches.length, 15);
  const radii = ranked.pitches.map((p) => ranked.radiusOf(p));
  near(radii[0], DISC.rIn, 1e-9);
  near(radii[14], DISC.rOut, 1e-9);
  for (let i = 1; i < radii.length; i++) near(radii[i] - radii[i - 1], (DISC.rOut - DISC.rIn) / 14, 1e-9);
  for (const ev of PHASE_MODEL.events) near(ev.radius, ranked.radiusOf(ev.pitch), 5, "lane offset is small");
  // low bass sits near the hub, bells on the outer ring
  assert.ok(PHASE_MODEL.events.find((ev) => ev.pitch === 40)!.radius < DISC.rIn + 20);
  assert.ok(PHASE_MODEL.events.find((ev) => ev.pitch === 88)!.radius > DISC.rOut - 20);
  const many = Array.from({ length: 30 }, (_, i) => note(i * 0.1, 40 + i * 2));
  const linear = buildRingMap(many);
  assert.equal(linear.ranked, false);
  near(linear.radiusOf(40), DISC.rIn, 1e-9);
  near(linear.radiusOf(98), DISC.rOut, 1e-9);
  near(linear.radiusOf(69), (DISC.rIn + DISC.rOut) / 2, 1e-9);
  assert.ok(linear.guideRadii.length >= 2);
  const single = buildRingMap([note(0, 60)]);
  near(single.radiusOf(60), (DISC.rIn + DISC.rOut) / 2, 1e-9);
});

test("voices get distinct palette colours by track, cycling for more than eight", () => {
  const hues = [1, 2, 3, 4].map((track) => PHASE_MODEL.events.find((ev) => ev.track === track)!.hue);
  assert.deepEqual(hues, [PALETTE[0].hue, PALETTE[1].hue, PALETTE[2].hue, PALETTE[3].hue]);
  assert.equal(new Set(hues).size, 4);
  const many = buildOrbit(synthetic(Array.from({ length: 10 }, (_, i) => note(i * 0.3, 60 + i, i + 1))));
  assert.equal(many.events[9].hue, PALETTE[9 % PALETTE.length].hue);
  assert.equal(many.events[8].hue, many.events[0].hue);
});

test("arc look: upcoming notes dim, struck notes bright with a fast white flash, then fading out", () => {
  const P = PHASE_MODEL.period;
  const ev = PHASE_MODEL.events.find((e) => e.track === 1 && e.timeSec > 20)!;
  const far = arcState(ev, ev.timeSec - WINDOW_AHEAD * P - 0.01, P);
  assert.equal(far.visible, false);
  const upcoming = arcState(ev, ev.timeSec - 0.8, P);
  assert.ok(upcoming.visible && upcoming.alpha > 0.15 && upcoming.alpha < 0.6 && upcoming.flash === 0 && upcoming.lit === 0);
  const hit = arcState(ev, ev.timeSec, P);
  const later = arcState(ev, ev.timeSec + 0.4, P);
  const gone = arcState(ev, ev.endSec + WINDOW_BEHIND * P + 0.01, P);
  assert.ok(hit.flash === 1 && later.flash < 0.05, "flash decays quickly");
  assert.ok(hit.alpha > upcoming.alpha && later.alpha < hit.alpha && later.alpha > 0.2);
  assert.equal(gone.visible, false);
  assert.ok(hit.spring === 1 && Math.abs(arcState(ev, ev.timeSec + 1, P).spring) < 0.01);
  // lit fraction grows with the playhead across a long note
  const long = PHASE_MODEL.events.find((e) => e.endSec - e.timeSec > 1)!;
  const half = arcState(long, long.timeSec + (long.endSec - long.timeSec) / 2, P);
  near(half.lit, 0.5, 1e-9);
  // the climax flare lifts everything
  assert.ok(arcState(ev, ev.timeSec - 1, P, 1).alpha > upcoming.alpha + 0.1);
  assert.ok(barPulse(0, 3) === 1 && barPulse(2.999, 3) < 0.01 && barPulse(3, 3) === 1 && barPulse(-1, 3) === 0);
  near(discRotation(90), -TAU, 1e-9);
});

test("visible window: about one revolution around the playhead, capped for dense files", () => {
  const P = PHASE_MODEL.period;
  for (const t of [-1, 0, 5.5, 25, 44.9, 48.05, 60]) {
    const [from, to] = visibleRange(PHASE_MODEL, t);
    const expected = PHASE_MODEL.events.filter((ev) => ev.timeSec >= t - WINDOW_BEHIND * P - PHASE_MODEL.maxVisualSec && ev.timeSec < t + WINDOW_AHEAD * P);
    assert.equal(to - from, expected.length, `t=${t}`);
    if (expected.length) assert.equal(PHASE_MODEL.events[from].index, expected[0].index);
    // anything the window drops is invisible
    for (const ev of PHASE_MODEL.events) if (ev.index < from || ev.index >= to) assert.equal(arcState(ev, t, P).visible, false, `note ${ev.index} at t=${t}`);
  }
  const dense = buildOrbit(synthetic(Array.from({ length: 5000 }, (_, i) => note(i * 0.004, 36 + Math.floor(hash01(i, 3) * 50), 1 + (i % 3), 0.05))));
  assert.equal(dense.events.length, 5000);
  const picked: number[] = [];
  pickVisible(dense, 10, picked);
  assert.ok(picked.length > 0 && picked.length <= MAX_ARCS, `${picked.length} arcs`);
  assert.ok(picked.every((index, i) => i === 0 || index > picked[i - 1]));
  pickVisible(PHASE_MODEL, 25, picked);
  const [from, to] = visibleRange(PHASE_MODEL, 25);
  assert.equal(picked.length, to - from);
});

test("framing: a 1000 px disc centred on (540, 930) with equal 40-60 px margins, legend and timeline centred", () => {
  assert.equal(DISC.cx, 540);
  assert.equal(DISC.cx, FRAME_CENTER_X);
  assert.equal(DISC.cy, 930);
  // the disc including its tick marks is about 1000 px wide, with the same margin on both sides
  const tickRadius = DISC.rim + 4 + TICK_MAX;
  const margin = 1080 / 2 - tickRadius;
  assert.ok(margin >= 40 && margin <= 60, `margin ${margin}`);
  assert.ok(2 * tickRadius >= 960 && 2 * tickRadius <= 1020, `diameter ${2 * tickRadius}`);
  assert.ok(DISC.rMax * (1 + DISC.maxZoom) + DISC.maxShift <= DISC.halfWidth, "zoom and camera shift keep the disc inside the frame");
  // vertical: well below the title (baselines 196 and 240), nothing important within 200 px of the bottom edge
  const reach = DISC.rMax * (1 + DISC.maxZoom) + DISC.maxShift;
  assert.ok(DISC.cy - reach > 300 && DISC.cy + reach < 1920 - 200);
  assert.ok(DISC.rOut + 34 <= DISC.rMax, "playhead tip");
  assert.ok(tickRadius <= DISC.rMax && DISC.plate <= DISC.rMax && DISC.bloomDiameter / 2 <= DISC.rMax);
  assert.ok(DISC.haloOut < DISC.haloExtent);
  assert.ok(strikeGlowDiameter(1) / 2 + DISC.rOut + 6 <= DISC.halfWidth, "even the strike glow of the outer ring stays inside the frame");
  for (let age = 0; age < 2; age += 0.01) for (let k = 0; k < 3; k++) {
    const wave = shockwave(age, k);
    if (wave) assert.ok(wave.radius + wave.width / 2 <= DISC.rMax);
  }
  // legend: every row is centred on x = 540 and stays inside the central 840 px (x 120..960), wrapping to rows
  const layouts = [[190, 150, 120, 110], [210, 160, 120, 130, 140], [300, 300, 300, 300], [90]];
  for (const widths of layouts) {
    const slots = legendLayout(widths);
    assert.equal(slots.length, widths.length);
    const rows = [...new Set(slots.map((slot) => slot.row))];
    for (const row of rows) {
      const inRow = slots.filter((slot) => slot.row === row);
      const left = Math.min(...inRow.map((slot) => slot.x));
      const right = Math.max(...inRow.map((slot) => slot.x + widths[slot.index]));
      near((left + right) / 2, 540, 0.5, `legend row ${row} centre`);
      assert.ok(left >= 120 && right <= 960, `legend row ${row}: ${left}..${right}`);
      assert.ok(right - left <= LEGEND.maxWidth + 1e-9);
    }
  }
  assert.ok(legendLayout([210, 160, 120, 130, 140]).some((slot) => slot.row === 1), "five long names wrap to a second row");
  assert.equal((TIMELINE.left + TIMELINE.right) / 2, 540);
  assert.ok(TIMELINE.left >= 120 && TIMELINE.right <= 960 && TIMELINE.y < 1920 - 200 && TIMELINE.y > LEGEND.y + LEGEND.rowGap + 40);
});

test("camera budget: breathing at most 1.5 percent, kicks at most 3 percent on top, everything returns to exactly 1.0", () => {
  assert.ok(breathing(1, 5, 1) <= 0.015 + 1e-12);
  assert.ok(DISC.maxZoom <= 0.05);
  const model = PHASE_MODEL;
  let worst = 0, over3 = 0, frames = 0;
  for (let frame = -66; frame < 3300; frame++) {
    const t = frame / 60;
    const kick = cameraKick(model.accents, t, 1);
    assert.ok(kick.zoom <= 0.03 + 1e-12 && kick.zoom >= 0);
    const zoom = cameraZoom(kick.zoom, breathing(barPulse(t, model.period), accentPulse(model.accents, t, 0.13), climaxEnvelope(model.climax, t, 0.75)));
    worst = Math.max(worst, zoom);
    if (zoom > 0.03) over3++;
    frames++;
    assert.ok(zoom >= 0 && zoom <= DISC.maxZoom + 1e-12);
  }
  assert.ok(worst <= 0.045 + 1e-12, `worst zoom ${worst}`);
  assert.ok(over3 / frames < 0.08, `${over3} of ${frames} frames above 3 percent`);
  assert.equal(cameraZoom(0, breathing(barPulse(-1, 3), 0, 0)), 0, "scale is exactly 1 before the music starts");
  assert.equal(cameraZoom(cameraKick(model.accents, 56, 1).zoom, breathing(barPulse(56, 3) * 0, accentPulse(model.accents, 56, 0.13), climaxEnvelope(model.climax, 56, 0.75))), 0, "and long after the last chord");
});

test("every arc, spark, glow and ring of all three files stays inside the frame budget", () => {
  const wide = synthetic(Array.from({ length: 300 }, (_, i) => note(i * 0.2, 21 + (i * 7) % 88, 1 + (i % 6), 0.3, 1 + (i * 13) % 127)));
  const point: SparkPoint = { x: 0, y: 0, alpha: 0, size: 0 };
  for (const [name, scene] of [...FILES.map((file) => [file, loadScene(file)] as const), ["wide", wide] as const]) {
    const model = buildOrbit(scene);
    const extent = maxArcExtent(model.events);
    assert.ok(extent <= DISC.rMax, `${name}: arcs reach ${extent}`);
    assert.ok(extent * (1 + DISC.maxZoom) + DISC.maxShift <= DISC.halfWidth, `${name}: arcs stay inside the frame at the largest zoom and shift`);
    for (const ring of model.ringMap.guideRadii) assert.ok(ring <= DISC.rOut && ring >= DISC.rIn);
    let alive = 0, farthest = 0;
    for (const ev of model.events) {
      for (let j = 0; j < ev.sparkCount; j++) {
        for (let age = 0; age < SPARK_MAX_LIFE; age += 0.025) {
          if (!sparkAt(ev, j, age, point)) continue;
          alive++;
          const reach = Math.hypot(point.x, point.y) + point.size / 2;
          farthest = Math.max(farthest, reach);
          assert.ok(reach <= DISC.halfWidth, `${name}: spark of note ${ev.index} reaches ${reach.toFixed(1)}`);
          assert.ok(point.alpha >= 0 && point.alpha <= 1 && Number.isFinite(point.x) && Number.isFinite(point.y));
        }
      }
    }
    assert.ok(alive > 100, `${name}: sparks exist`);
    assert.ok(farthest > 330, `${name}: sparks travel well past the rings (${farthest})`);
  }
  const dust: DustPoint = { x: 0, y: 0, alpha: 0, size: 0, hue: 0, depth: 0 };
  for (let i = 0; i < DUST_COUNT + 12; i++) for (const t of [-1, 0, 20, 80]) {
    dustAt(i, t, 1080, 1920, dust);
    assert.ok(dust.x >= -40 && dust.x <= 1120 && dust.y >= -40 && dust.y <= 1960 && dust.alpha >= 0 && dust.alpha <= 1);
  }
});

test("timeline markers: voice entrances, the 45 s unison and the climax", () => {
  const markers = PHASE_MODEL.markers;
  assert.ok(markers.every((m, i) => i === 0 || m.timeSec >= markers[i - 1].timeSec));
  const voices = markers.filter((m) => m.kind === "voice");
  assert.equal(voices.length, 4);
  near(voices[0].timeSec, 0, 1e-9);
  near(voices[1].timeSec, 6, 0.01);
  assert.ok(voices[2].timeSec > 14.9 && voices[2].timeSec < 15.5);
  near(voices[3].timeSec, 18, 0.01);
  const align = markers.filter((m) => m.kind === "align");
  assert.equal(align.length, 1, "only the four-voice unison is a landmark");
  near(align[0].timeSec, 45, 0.02);
  const canon = buildOrbit(loadScene("canon-in-d.mid")).markers.filter((m) => m.kind === "align");
  assert.ok(canon.length >= 1 && canon.length <= 3);
  const climax = markers.filter((m) => m.kind === "climax");
  assert.equal(climax.length, 1);
  near(climax[0].timeSec, 48, 0.01);
  assert.deepEqual(buildOrbit(synthetic([])).markers, []);
  assert.equal(buildOrbit(synthetic([note(1, 60)])).markers.length, 1);
});

test("sparks fly outward from the strike point and are pure functions of (note, index, age)", () => {
  const ev = PHASE_MODEL.events[100];
  const a: SparkPoint = { x: 0, y: 0, alpha: 0, size: 0 };
  assert.ok(sparkAt(ev, 0, 0, a));
  near(Math.hypot(a.x, a.y), ev.radius, 1e-6, "starts on the arc");
  near(Math.abs(angleDiff(Math.atan2(a.x, -a.y), ev.angle)), 0, 1e-6, "starts at the leading edge");
  assert.equal(a.alpha, 1);
  let last = 0;
  for (let age = 0; age < 0.3; age += 0.01) {
    assert.ok(sparkAt(ev, 0, age, a));
    assert.ok(Math.hypot(a.x, a.y) >= last - 1e-9, "moves outward");
    last = Math.hypot(a.x, a.y);
  }
  assert.equal(sparkAt(ev, 0, -0.01, a), false);
  assert.equal(sparkAt(ev, 0, 5, a), false);
  // evaluation order does not matter, and different notes get different bursts
  const ages = [0.05, 0.4, 0.2, 0.01, 0.33];
  const sample = (event: typeof ev, order: number[]) => order.map((age) => {
    const p: SparkPoint = { x: 0, y: 0, alpha: 0, size: 0 };
    return [age, sparkAt(event, 2, age, p), p.x, p.y, p.alpha, p.size];
  });
  const forward = sample(ev, ages), backward = sample(ev, [...ages].reverse()).reverse();
  assert.deepEqual(forward, backward);
  assert.notDeepEqual(sample(ev, ages), sample(PHASE_MODEL.events[101], ages));
  const d1: DustPoint = { x: 0, y: 0, alpha: 0, size: 0, hue: 0, depth: 0 }, d2 = { ...d1 };
  dustAt(7, 12.5, 1080, 1920, d1);
  dustAt(3, 99, 1080, 1920, d2);
  dustAt(7, 12.5, 1080, 1920, d2);
  assert.deepEqual(d1, d2);
});

// ---- painter smoke tests with a recording fake canvas -------------------------------------------------

type Call = string;
function recorder(log: Call[], problems: string[]) {
  const fmt = (value: unknown): string => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) problems.push("non-finite number " + value);
      return value.toFixed(5);
    }
    return typeof value === "object" && value !== null ? "[object]" : String(value);
  };
  const gradient = () => ({ addColorStop: (offset: number, colour: string) => { log.push(`stop(${fmt(offset)},${colour})`); } });
  const store: Record<string, unknown> = {};
  return new Proxy({}, {
    get(_target, prop: string) {
      if (prop in store) return store[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return (...args: unknown[]) => { log.push(`${prop}(${args.map(fmt).join(",")})`); return gradient(); };
      }
      if (prop === "measureText") return (text: string) => ({ width: text.length * 12, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 12 });
      return (...args: unknown[]) => { log.push(`${prop}(${args.map(fmt).join(",")})`); };
    },
    set(_target, prop: string, value: unknown) {
      store[prop] = value;
      log.push(`${prop}=${fmt(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function withFakeDocument<T>(run: () => T): T {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => recorder([], []) }) };
  try { return run(); } finally { g.document = before; }
}

test("painter: pure function of the frame, no NaN, bounded work, for all files and degenerate inputs", () => {
  withFakeDocument(() => {
    const scenes: [string, MidiSceneData][] = [
      ...FILES.map((file) => [file, loadScene(file)] as [string, MidiSceneData]),
      ["empty", synthetic([])],
      ["one note", synthetic([note(1, 60)])],
      ["dense", synthetic(Array.from({ length: 4000 }, (_, i) => note(i * 0.01, 30 + Math.floor(hash01(i, 5) * 70), 1 + (i % 5), 0.1 + hash01(i, 6))))],
    ];
    for (const [name, scene] of scenes) {
      const painter = createOrbitPainter(scene, "Phase Orbit");
      const model = buildOrbit(scene);
      const frames = [0, 1, 30, scene.leadFrames, scene.leadFrames + 1, Math.floor(scene.totalFrames / 2), scene.totalFrames - 2, scene.totalFrames - 1];
      for (const index of [0, 7, Math.floor(scene.notes.length / 2), scene.notes.length - 1]) {
        if (scene.notes[index]) frames.push(onsetFrame(scene, scene.notes[index].timeSec), onsetFrame(scene, scene.notes[index].timeSec) + 9);
      }
      if (model.climax) frames.push(onsetFrame(scene, model.climax.timeSec), onsetFrame(scene, model.climax.timeSec) + 70);
      const paint = (frame: number) => {
        const log: Call[] = [], problems: string[] = [];
        painter(recorder(log, problems), frame);
        assert.deepEqual(problems, [], `${name} frame ${frame}`);
        return log;
      };
      const first = new Map<number, Call[]>();
      for (const frame of frames) first.set(frame, paint(frame));
      for (const frame of [...frames].reverse()) assert.deepEqual(paint(frame), first.get(frame), `${name}: frame ${frame} repeated in another order`);
      const busiest = Math.max(...[...first.values()].map((log) => log.length));
      assert.ok(busiest < 40000, `${name}: ${busiest} canvas calls in the busiest frame`);
      assert.ok(first.get(frames[0])!.some((call) => call.startsWith("drawImage")), name);
    }
  });
});

test("painter: the title and vignette are drawn, and the last frames are covered by the end fade", () => {
  withFakeDocument(() => {
    const painter = createOrbitPainter(PHASE, "Phase Orbit");
    const log: Call[] = [], problems: string[] = [];
    painter(recorder(log, problems), PHASE.totalFrames - 1);
    assert.deepEqual(problems, []);
    assert.ok(log.some((call) => call.startsWith("fillText(Pentatonic Phase") || call.includes("Pentatonic Phase")));
    assert.ok(log.some((call) => call.startsWith("createRadialGradient(540.00000,960.00000")), "vignette is centred on the canvas");
    const last = log.filter((call) => call.startsWith("fillRect(0.00000,0.00000,1080.00000,1920.00000)"));
    assert.ok(last.length >= 2, "vignette and end fade each cover the canvas");
    assert.ok(log.some((call) => call === "globalAlpha=1.00000"));
  });
});
