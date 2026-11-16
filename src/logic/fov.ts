/**
 * Field-of-view-aware layout.
 *
 * Meta VR Glasses see about 70 x 66 degrees, a Quest 3 about 110 x 96. A board
 * that fills a Quest's view is cut off on the glasses, most of all when you sit
 * close to the wall. So the board is shrunk until it fits inside a comfortable
 * part of whatever view this device really has (read from its projection).
 *
 * Plain TypeScript, unit-tested.
 */

/** Full view angles, in radians. */
export interface Fov {
  h: number;
  v: number;
}

export const FOV = {
  /** The board may fill at most this share of the view, so its edges are never at the rim. */
  fill: 0.8,
  /** Never shrink below this: smaller text is not readable. */
  minScale: 0.45,
  /** A point counts as "in view" inside this share of the half angle: the comfortable middle, not the rim. */
  seen: 0.65,
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** View angles from a WebXR projection matrix (elements 0 and 5). Null when unusable. */
export function fovFromProjection(m0: number, m5: number): Fov | null {
  if (!Number.isFinite(m0) || !Number.isFinite(m5) || m0 <= 0 || m5 <= 0) return null;
  const fov = { h: 2 * Math.atan(1 / m0), v: 2 * Math.atan(1 / m5) };
  // A real headset is somewhere between 30 and 170 degrees; anything else is a bad matrix.
  if (fov.h < rad(30) || fov.h > rad(170) || fov.v < rad(30) || fov.v > rad(170)) return null;
  return fov;
}

export const fovFromDegrees = (h: number, v: number): Fov => ({ h: rad(h), v: rad(v) });

/**
 * The scale at which a board of `size` metres, `distance` metres away, fits inside
 * the comfortable part of the view. Never bigger than `scale` (what placement asked for).
 */
export function fitScale(
  size: { width: number; height: number },
  distance: number,
  fov: Fov,
  scale: number,
): number {
  if (!(distance > 0)) return scale;
  const maxW = 2 * distance * Math.tan((fov.h * FOV.fill) / 2);
  const maxH = 2 * distance * Math.tan((fov.v * FOV.fill) / 2);
  const fit = Math.min(maxW / size.width, maxH / size.height);
  return Math.max(FOV.minScale, Math.min(scale, fit));
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Is `point` inside the view when the head at `head` looks along `forward`? */
export function inView(head: P3, forward: P3, point: P3, fov: Fov): boolean {
  const d = { x: point.x - head.x, y: point.y - head.y, z: point.z - head.z };
  const dl = Math.hypot(d.x, d.y, d.z);
  const fl = Math.hypot(forward.x, forward.y, forward.z);
  if (dl < 1e-6 || fl < 1e-6) return true;
  const cos = (d.x * forward.x + d.y * forward.y + d.z * forward.z) / (dl * fl);
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  return angle <= (Math.min(fov.h, fov.v) / 2) * FOV.seen;
}
