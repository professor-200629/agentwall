/**
 * Where the board goes. Plain TypeScript, no Three.js or XR imports, so it can
 * be unit-tested in Node.
 *
 * Coordinates are world space in metres, +Y up (WebXR local-floor convention).
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A detected plane, copied out of WebXR into plain numbers. */
export interface PlaneInput {
  id: number;
  /** Plane-space origin in world space. */
  position: V3;
  /** Plane-space rotation. Plane-space +Y is the plane normal (WebXR spec). */
  orientation: Quat;
  /** Polygon in plane space; every point has y = 0, so only x and z matter. */
  polygon: ReadonlyArray<{ x: number; z: number }>;
  vertical: boolean;
  /** WebXR semantic label ('wall', 'door', 'window', ...) when the device gives one. */
  label?: string;
}

export interface BoardSize {
  width: number;
  height: number;
}

export interface Placement {
  kind: 'wall' | 'fallback';
  position: V3;
  /** Rotation about world +Y; the board's front (+Z) faces this way. */
  yaw: number;
  /** Distance from the head to the board centre, metres. */
  distance: number;
  planeId?: number;
}

export const BOARD: BoardSize = { width: 1.2, height: 0.75 };

/** Tuning, kept in one place so tests and the XR system agree. */
export const PLACEMENT = {
  /** Gap between wall and board so it never z-fights with the real wall. */
  wallGap: 0.02,
  /** Walls nearer than this are probably the user's own side; farther ones are too far to read. */
  minWallDistance: 0.4,
  maxWallDistance: 4.0,
  /** A wall must lie roughly in front: max angle between gaze and board centre. */
  maxAngleDeg: 60,
  /** Board centre sits a little below the eyes, which is comfortable when seated. */
  belowEye: 0.1,
  /** Smallest wall we accept, as a fraction of the board size. */
  minFit: 0.8,
  /** Fallback distance in front of the user. */
  fallbackDistance: 1.2,
} as const;

/** Labels that mean "this vertical plane is not a free wall". */
const NOT_A_WALL = new Set(['door', 'window', 'screen', 'wall_art', 'wall art']);

const UP: V3 = { x: 0, y: 1, z: 0 };

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3): number => Math.sqrt(dot(a, a));
const clamp = (v: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));

export function rotate(q: Quat, v: V3): V3 {
  // v' = q * v * q^-1, expanded.
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Horizontal unit vector of the gaze. Looking straight up/down falls back to -Z. */
export function flatForward(forward: V3): V3 {
  const f = { x: forward.x, y: 0, z: forward.z };
  const l = len(f);
  return l < 1e-3 ? { x: 0, y: 0, z: -1 } : scale(f, 1 / l);
}

/** Yaw that turns the board's +Z to point along the horizontal direction d. */
export const yawFacing = (d: V3): number => Math.atan2(d.x, d.z);

function angleDeg(a: V3, b: V3): number {
  const c = dot(a, b) / (len(a) * len(b) || 1);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

export interface WallCandidate extends Placement {
  angleDeg: number;
  score: number;
}

/**
 * Try to put the board on one plane. Returns null when the plane is not a
 * usable wall from where the user is.
 */
export function placeOnWall(
  head: V3,
  forward: V3,
  plane: PlaneInput,
  board: BoardSize = BOARD,
): WallCandidate | null {
  if (!plane.vertical) return null;
  if (plane.label && NOT_A_WALL.has(plane.label.toLowerCase())) return null;
  if (plane.polygon.length < 3) return null;

  // Normal, made horizontal and pointed at the user.
  let n = rotate(plane.orientation, UP);
  n = { x: n.x, y: 0, z: n.z };
  const nl = len(n);
  if (nl < 1e-3) return null;
  n = scale(n, 1 / nl);
  if (dot(n, sub(head, plane.position)) < 0) n = scale(n, -1);

  const dist = dot(sub(head, plane.position), n);
  if (dist < PLACEMENT.minWallDistance || dist > PLACEMENT.maxWallDistance) return null;

  // Wall extent along its horizontal tangent (u) and world height (v).
  const t: V3 = { x: -n.z, y: 0, z: n.x };
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of plane.polygon) {
    const w = add(plane.position, rotate(plane.orientation, { x: p.x, y: 0, z: p.z }));
    const u = dot(sub(w, plane.position), t);
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, w.y);
    vMax = Math.max(vMax, w.y);
  }
  if (uMax - uMin < board.width * PLACEMENT.minFit) return null;
  if (vMax - vMin < board.height * PLACEMENT.minFit) return null;

  // Where the user is looking on this wall (or the foot of the perpendicular).
  const f = flatForward(forward);
  const towardWall = -dot(f, n);
  let u: number;
  if (towardWall > 0.2) {
    const hit = add(head, scale(f, dist / towardWall));
    u = dot(sub(hit, plane.position), t);
  } else {
    u = dot(sub(head, plane.position), t);
  }
  u = clamp(u, uMin + board.width / 2, uMax - board.width / 2);
  const y = clamp(
    head.y - PLACEMENT.belowEye,
    vMin + board.height / 2,
    vMax - board.height / 2,
  );

  const onWall = add(plane.position, scale(t, u));
  const position = add({ x: onWall.x, y, z: onWall.z }, scale(n, PLACEMENT.wallGap));
  const toBoard = sub(position, head);
  const angle = angleDeg(f, { x: toBoard.x, y: 0, z: toBoard.z });
  if (angle > PLACEMENT.maxAngleDeg) return null;

  const distance = len(toBoard);
  return {
    kind: 'wall',
    position,
    yaw: yawFacing(n),
    distance,
    planeId: plane.id,
    angleDeg: angle,
    // Prefer the wall straight ahead, then the nearer one.
    score: angle + 4 * distance,
  };
}

/** Best wall in front of the user, or null when there is none. */
export function chooseWall(
  head: V3,
  forward: V3,
  planes: ReadonlyArray<PlaneInput>,
  board: BoardSize = BOARD,
): WallCandidate | null {
  let best: WallCandidate | null = null;
  for (const plane of planes) {
    const c = placeOnWall(head, forward, plane, board);
    if (c && (best === null || c.score < best.score)) best = c;
  }
  return best;
}

/** Required fallback: 1.2 m in front of the user at eye height, facing them. */
export function fallbackPlacement(head: V3, forward: V3): Placement {
  const f = flatForward(forward);
  const d = PLACEMENT.fallbackDistance;
  return {
    kind: 'fallback',
    position: { x: head.x + f.x * d, y: head.y, z: head.z + f.z * d },
    yaw: yawFacing(scale(f, -1)),
    distance: d,
  };
}
