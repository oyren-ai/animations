import { VIDEO } from "../settings.ts";

export const WAVE = { count: 12, firstCycles: 5, period: VIDEO.sceneSeconds, amplitude: 0.4, longest: 760, shortest: 300, pivot: { x: 540, y: 555 } } as const;

/** Closed-form visual oscillators, each completing one extra cycle per loop. */
export function bobAt(index: number, seconds: number) {
  if (!Number.isInteger(index) || index < 0 || index >= WAVE.count) throw new RangeError("Invalid pendulum index");
  const length = WAVE.longest - index * (WAVE.longest - WAVE.shortest) / (WAVE.count - 1);
  const omega = Math.PI * 2 * (WAVE.firstCycles + index) / WAVE.period;
  const angle = WAVE.amplitude * Math.cos(omega * seconds);
  const speed = -WAVE.amplitude * omega * Math.sin(omega * seconds);
  return { x: WAVE.pivot.x + length * Math.sin(angle), y: WAVE.pivot.y + length * Math.cos(angle),
    vx: length * Math.cos(angle) * speed, vy: -length * Math.sin(angle) * speed, length };
}
