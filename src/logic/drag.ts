/**
 * Grab and move: the board and the desk card each have a grab bar, like the
 * floating windows of Quest itself. Pinch the bar and move your hand: the thing
 * follows the hand ray. Push your hand away to send it farther, pull to bring
 * it closer. Let the board go near a real wall and it snaps onto the wall.
 *
 * Asked for by a Meta mentor who tried the app on a Quest 3 (16 Nov): "you are
 * used to grabbing it and putting it far or moving it to the wall... it feels a
 * little bit weird that you have to accommodate yourself instead of fixing the
 * window."
 *
 * Plain TypeScript, unit-tested. The XR system feeds it the pointer's ray.
 */
import {
  BOARD,
  PLACEMENT,
  dot,
  sub,
  wallFrame,
  yawFacing,
  type BoardSize,
  type Placement,
  type PlaneInput,
  type V3,
} from './placement.js';

export const DRAG = {
  /** Metres the board moves away for each metre the hand moves away from the head. */
  boardGain: 6,
  boardMin: 0.6,
  boardMax: 4,
  /** The card is near the body: gentler, and it stays within arm's-length-and-a-bit. */
  cardGain: 2.5,
  cardMin: 0.35,
  cardMax: 1.6,
  /** A board let go within this distance of a wall snaps onto it (m). */
  snap: 0.35,
  /** The pinched point must move this far before anything moves: a tap on a bar does nothing (m). */
  deadZone: 0.025,
} as const;

const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

/**
 * How far along the ray the grabbed point should be now.
 * @param d0 distance from the pointer to the grabbed point when the pinch started
 * @param r0 distance from the head to the pointer when the pinch started
 * @param r  that distance now (a hand pushed away from the body makes it larger)
 */
export function pushPull(d0: number, r0: number, r: number, gain: number, min: number, max: number): number {
  const d = d0 + (r - r0) * gain;
  if (!Number.isFinite(d)) return Math.min(max, Math.max(min, d0));
  return Math.min(max, Math.max(min, d));
}

/** The point `dist` metres from `origin` toward `through` (or straight ahead, -Z, when they coincide). */
export function along(origin: V3, through: V3, dist: number): V3 {
  const d = sub(through, origin);
  const l = len(d);
  if (l < 1e-6) return { x: origin.x, y: origin.y, z: origin.z - dist };
  const k = dist / l;
  return { x: origin.x + d.x * k, y: origin.y + d.y * k, z: origin.z + d.z * k };
}

/** Yaw that turns something at `at` to face `head` (0 when it is straight above or below). */
export function facing(at: V3, head: V3): number {
  const d = { x: head.x - at.x, y: 0, z: head.z - at.z };
  return Math.hypot(d.x, d.z) < 1e-4 ? 0 : yawFacing(d);
}

/**
 * The centre of a thing whose grabbed point (lx, ly in its own unscaled local
 * metres) must sit at `target`, when it is upright and turned by `yaw`.
 */
export function centreFromGrab(target: V3, yaw: number, lx: number, ly: number, scale: number): V3 {
  // Local +X in world space for a rotation of `yaw` about +Y.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return { x: target.x - rx * lx * scale, y: target.y - ly * scale, z: target.z - rz * lx * scale };
}

/**
 * The board was let go at `centre`. If a real wall is within reach of it, the
 * placement on that wall (kept inside the wall's edges); otherwise null and the
 * board stays floating where it is.
 */
export function snapToWall(
  centre: V3,
  head: V3,
  planes: ReadonlyArray<PlaneInput>,
  scale: number,
  board: BoardSize = BOARD,
): Placement | null {
  let best: { p: Placement; gap: number } | null = null;
  const w = board.width * scale;
  const h = board.height * scale;
  for (const plane of planes) {
    const frame = wallFrame(head, plane);
    if (!frame) continue;
    const { n, t, uMin, uMax, vMin, vMax } = frame;
    const rel = sub(centre, plane.position);
    const gap = Math.abs(dot(rel, n));
    if (gap > DRAG.snap) continue;
    // The board must fit on the wall at the size it has now.
    if (uMax - uMin < w || vMax - vMin < h) continue;
    const u = Math.min(uMax - w / 2, Math.max(uMin + w / 2, dot(rel, t)));
    const y = Math.min(vMax - h / 2, Math.max(vMin + h / 2, centre.y));
    const position = {
      x: plane.position.x + t.x * u + n.x * PLACEMENT.wallGap,
      y,
      z: plane.position.z + t.z * u + n.z * PLACEMENT.wallGap,
    };
    const p: Placement = {
      kind: 'wall',
      position,
      yaw: yawFacing(n),
      distance: len(sub(position, head)),
      scale,
      planeId: plane.id,
    };
    if (!best || gap < best.gap) best = { p, gap };
  }
  return best ? best.p : null;
}
