/**
 * Palm-up to call the board: hold either open hand with the palm toward your
 * face for a second and the board comes to where you are looking.
 *
 * Quest's own system gesture is palm up AND pinch (menu / Meta button), so this
 * one is palm toward the face with NO pinch, held for a full second while a
 * ring fills, so it is always on purpose. Plain TypeScript, unit-tested.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: P3) => Math.sqrt(dot(a, a));
const cross = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

export const PALM = {
  /** Max angle between the palm's normal and the line to the eyes. */
  maxAngleDeg: 45,
  /** The hand must be in front of you, not at your side or far away. */
  minDist: 0.15,
  maxDist: 0.75,
  /** Thumb and index tips closer than this = a pinch (Quest's system gesture). */
  pinchDist: 0.03,
  /**
   * Fingers must point up (wrist -> middle knuckle, world up component). Looking at
   * your palm has the fingers up; aiming down at the desk card does not, so resting
   * the ray on the card can never send the board away (found in the emulator).
   */
  minFingersUp: 0.3,
  holdSeconds: 1.0,
  cooldownSeconds: 2.0,
} as const;

/**
 * The palm's outward normal (the side the palm faces), from three joints.
 * For a right hand cross(index-knuckle − wrist, pinky-knuckle − wrist) points out
 * of the palm; a left hand is the mirror image.
 */
export function palmNormal(wrist: P3, indexKnuckle: P3, pinkyKnuckle: P3, hand: 'left' | 'right'): P3 {
  const n = cross(sub(indexKnuckle, wrist), sub(pinkyKnuckle, wrist));
  const l = len(n) || 1;
  const s = hand === 'left' ? -1 / l : 1 / l;
  return { x: n.x * s, y: n.y * s, z: n.z * s };
}

/** Is this palm held toward the face, fingers up, close enough, and not pinching? */
export function palmTowardFace(palm: P3, normal: P3, head: P3, thumbTip: P3, indexTip: P3, fingers: P3): boolean {
  const fl = len(fingers) || 1;
  if (fingers.y / fl < PALM.minFingersUp) return false;
  const toHead = sub(head, palm);
  const d = len(toHead);
  if (d < PALM.minDist || d > PALM.maxDist) return false;
  if (len(sub(thumbTip, indexTip)) < PALM.pinchDist) return false;
  const cos = dot(normal, toHead) / d;
  return cos >= Math.cos((PALM.maxAngleDeg * Math.PI) / 180);
}

export type PalmEvent = 'idle' | 'charging' | 'summon';

/** Hold the palm toward your face for a second: the board comes to you. */
export class PalmSummon {
  progress = 0;
  private cooldown = 0;
  private waitForRelease = false;

  constructor(private readonly holdSeconds: number = PALM.holdSeconds) {}

  update(dt: number, facing: boolean): PalmEvent {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.cooldown = Math.max(0, this.cooldown - step);
    if (!facing) {
      this.waitForRelease = false;
      this.progress = Math.max(0, this.progress - step * 3);
      return 'idle';
    }
    if (this.waitForRelease || this.cooldown > 0) return 'idle';
    this.progress = Math.min(1, this.progress + step / this.holdSeconds);
    if (this.progress >= 1) {
      this.progress = 0;
      this.cooldown = PALM.cooldownSeconds;
      this.waitForRelease = true;
      return 'summon';
    }
    return 'charging';
  }
}
