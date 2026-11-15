/**
 * Same wall next time: remember which wall the board was on, and where on it,
 * so the next session puts the board back on the same spot.
 *
 * No WebXR anchors (they restored one shared anchor and could shift the board).
 * Instead a wall "fingerprint": its label, width, height and bottom edge, plus
 * the board's distance from the wall's left end and its height above the floor.
 * All of these are measured in the room, never in session coordinates, so they
 * survive the user starting the next session from a different spot.
 *
 * Assumption (unverified on a Quest): Space Setup reports the same wall sizes
 * every session. A wall re-scanned more than SAME_WALL.tolerance off simply
 * does not match, and the board is placed as usual.
 *
 * Plain TypeScript, unit-tested.
 */
import {
  BOARD,
  dot,
  PLACEMENT,
  spotOnWall,
  sub,
  type SpotLimits,
  wallFrame,
  type BoardSize,
  type PlaneInput,
  type V3,
  type WallCandidate,
  type WallFrame,
} from './placement.js';

export interface WallPrint {
  /** Semantic label, 'wall' when the device gives none. */
  label: string;
  /** Wall width and height, metres. */
  width: number;
  height: number;
  /** Height of the wall's bottom edge (local-floor: above the floor). */
  bottom: number;
  /** Board centre: metres from the wall's left end, as seen from inside the room. */
  fromLeft: number;
  /** Board centre height above the floor. */
  y: number;
}

export const SAME_WALL = {
  /** How far each size may differ and still count as the same wall. */
  tolerance: 0.08,
  /**
   * A new session uses the old spot only when it is nearly where the user looks.
   * The first real Quest test (15 Nov) found a remembered spot 20° to the side
   * reads as "off-centre, and I can't move it"; beyond this the board is centred
   * on the gaze instead.
   */
  maxAngleDeg: 15,
  storageKey: 'agentwall.wall.v1',
} as const;

/** After a headset recenter the board must stay put in the room, wherever the user looks. */
export const ANY_ANGLE: SpotLimits = { maxAngle: 180, maxFacing: Infinity };
const NEAR_GAZE: SpotLimits = { maxAngle: SAME_WALL.maxAngleDeg, maxFacing: PLACEMENT.maxFacingDeg };

const labelOf = (plane: PlaneInput): string => (plane.label ?? 'wall').toLowerCase();

/** Fingerprint of the wall the board sits on, or null when the plane is not a wall. */
export function wallPrint(head: V3, plane: PlaneInput, boardPos: V3): WallPrint | null {
  const f = wallFrame(head, plane);
  if (!f) return null;
  const u = dot(sub(boardPos, plane.position), f.t);
  return {
    label: labelOf(plane),
    width: f.uMax - f.uMin,
    height: f.vMax - f.vMin,
    bottom: f.vMin,
    fromLeft: f.uMax - u, // t points left, so the left end is at uMax
    y: boardPos.y,
  };
}

/** Does this wall have the remembered label and size? */
export function matchesPrint(plane: PlaneInput, frame: WallFrame, print: WallPrint): boolean {
  const tol = SAME_WALL.tolerance;
  return (
    labelOf(plane) === print.label &&
    Math.abs(frame.uMax - frame.uMin - print.width) <= tol &&
    Math.abs(frame.vMax - frame.vMin - print.height) <= tol &&
    Math.abs(frame.vMin - print.bottom) <= tol
  );
}

/**
 * The remembered spot on the remembered wall, if that wall is here and the spot
 * is near where the user looks (or anywhere, with ANY_ANGLE after a recenter).
 * Two walls of the same size (opposite walls of a rectangular room) are told
 * apart by where the user is looking.
 */
export function placeOnRememberedWall(
  head: V3,
  forward: V3,
  planes: ReadonlyArray<PlaneInput>,
  print: WallPrint,
  limits: SpotLimits = NEAR_GAZE,
  board: BoardSize = BOARD,
): WallCandidate | null {
  let best: WallCandidate | null = null;
  for (const plane of planes) {
    const frame = wallFrame(head, plane);
    if (!frame || !matchesPrint(plane, frame, print)) continue;
    const c = spotOnWall(head, forward, plane, frame, frame.uMax - print.fromLeft, print.y, limits, board);
    if (c && (best === null || c.score < best.score)) best = { ...c, remembered: true };
  }
  return best;
}

export function serializePrint(print: WallPrint): string {
  return JSON.stringify({ v: 1, ...print });
}

/** Parse a saved fingerprint; anything malformed or out of range gives null. */
export function parsePrint(json: string | null): WallPrint | null {
  if (!json) return null;
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number) =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi;
  if (o.v !== 1 || typeof o.label !== 'string' || o.label.length > 40) return null;
  if (!num('width', 0.1, 50) || !num('height', 0.1, 20) || !num('bottom', -5, 10)) return null;
  if (!num('fromLeft', -1, 50) || !num('y', -5, 10)) return null;
  return {
    label: o.label,
    width: o.width as number,
    height: o.height as number,
    bottom: o.bottom as number,
    fromLeft: o.fromLeft as number,
    y: o.y as number,
  };
}
