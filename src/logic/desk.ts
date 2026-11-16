/**
 * Where the invite card goes for the decision: on the user's real table/desk
 * when one is detected in front of them, otherwise in front of their seat.
 * "The wall thinks, the desk decides." Plain TypeScript, unit-tested.
 *
 * 16 Nov: a Meta mentor tried the app on a Quest 3 and said the card "is way too
 * close, I had to go a little bit back all the time". It sat 45 cm ahead, 57 cm
 * from the eyes. It now sits about 80 cm from the eyes, lower and leaning back
 * more (like a sheet on a desk), so it does not stand between the hands and the
 * lower part of the board. It is drawn a little larger, half-way between "the
 * same size in the room" and "the same size in your view": he stepped back from
 * the old size and was comfortable, so the text may be a little smaller than it
 * was. The user can also drag it wherever they like (`placedByHand`).
 */
import { flatForward, rotate, yawFacing, type PlaneInput, type V3 } from './placement.js';

export interface DeskPlacement {
  /** 'placed' = the user dragged the card there themselves. */
  kind: 'desk' | 'lap' | 'placed';
  /** Card centre in world space. */
  position: V3;
  /** Rotation about +Y so the card faces the user. */
  yaw: number;
  /** Lean back (radians) so the card tilts up toward the user's eyes. */
  tilt: number;
  /** Uniform scale of the card, so it reads the same at any distance. */
  scale: number;
  planeId?: number;
}

export const DESK = {
  /** Table tops between these heights (m) count; floors, couches and shelves don't. */
  minHeight: 0.55,
  maxHeight: 1.15,
  /** Nearest table edge must be within this horizontal reach (m) and in front. */
  maxReach: 1.0,
  maxAngleDeg: 70,
  /** The card sits at least this far in from the near edge, and this high above the top (m). */
  inset: 0.14,
  lift: 0.06,
  tilt: (35 * Math.PI) / 180,
  /** Comfortable horizontal distance from the eyes to the card (m), on a table or in the lap. */
  comfort: 0.65,
  /** No table: in front of and below the eyes (m), leaning back like a sheet on a desk. */
  lapForward: 0.62,
  lapBelowEye: 0.52,
  lapTilt: (50 * Math.PI) / 180,
  /** The card's scale at `scaleAt` metres from the eyes; farther cards are drawn somewhat larger. */
  baseScale: 0.55,
  scaleAt: 0.57,
  minScale: 0.5,
  maxScale: 1.1,
  /** A card the user placed never leans back more than this. */
  maxTilt: (60 * Math.PI) / 180,
};

const TABLE_LABELS = new Set(['table', 'desk']);

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const flatLen = (a: V3) => Math.hypot(a.x, a.z);

/**
 * The card's scale at this distance: it grows with the square root of the distance,
 * so a farther card is larger in the room but a little smaller in your view.
 */
export function cardScale(head: V3, position: V3): number {
  const d = Math.hypot(position.x - head.x, position.y - head.y, position.z - head.z);
  return Math.min(DESK.maxScale, Math.max(DESK.minScale, DESK.baseScale * Math.sqrt(d / DESK.scaleAt)));
}

export function lapPlacement(head: V3, forward: V3): DeskPlacement {
  const f = flatForward(forward);
  const position = {
    x: head.x + f.x * DESK.lapForward,
    y: head.y - DESK.lapBelowEye,
    z: head.z + f.z * DESK.lapForward,
  };
  return {
    kind: 'lap',
    position,
    yaw: yawFacing({ x: -f.x, y: 0, z: -f.z }),
    tilt: DESK.lapTilt,
    scale: cardScale(head, position),
  };
}

/**
 * How a card must turn to face the eyes from the point `at`: its yaw, and how far it
 * leans back (never forward, and never flatter than the limit).
 */
export function faceEyes(head: V3, at: V3): { yaw: number; tilt: number } {
  const back = sub(head, at);
  const flat = flatLen(back);
  return {
    yaw: flat < 1e-4 ? 0 : yawFacing({ x: back.x, y: 0, z: back.z }),
    tilt: Math.min(DESK.maxTilt, Math.max(0, Math.atan2(back.y, flat || 1e-6))),
  };
}

/** Best table in front of the user within reach, else the lap spot. */
export function chooseDesk(head: V3, forward: V3, planes: ReadonlyArray<PlaneInput>): DeskPlacement {
  const f = flatForward(forward);
  let best: { place: DeskPlacement; score: number } | null = null;
  for (const plane of planes) {
    if (plane.vertical || plane.polygon.length < 3) continue;
    const label = plane.label?.toLowerCase();
    if (label && !TABLE_LABELS.has(label)) continue; // floor, couch, bed, ceiling…
    const y = plane.position.y;
    if (y < DESK.minHeight || y > DESK.maxHeight) continue;

    // Table outline in world space; nearest corner/edge point to the user.
    const pts = plane.polygon.map((p) => {
      const w = rotate(plane.orientation, { x: p.x, y: 0, z: p.z });
      return { x: plane.position.x + w.x, y, z: plane.position.z + w.z };
    });
    // Nearest point on the table's outline (edges, not just corners).
    let near = pts[0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ab = sub(b, a);
      const len2 = ab.x * ab.x + ab.z * ab.z || 1;
      const t = Math.max(0, Math.min(1, ((head.x - a.x) * ab.x + (head.z - a.z) * ab.z) / len2));
      const q = { x: a.x + ab.x * t, y, z: a.z + ab.z * t };
      if (flatLen(sub(q, head)) < flatLen(sub(near, head))) near = q;
    }
    const toNear = sub(near, head);
    const reach = flatLen(toNear);
    if (reach > DESK.maxReach) continue;
    const toCentre = sub(plane.position, head);
    const cos = (f.x * toCentre.x + f.z * toCentre.z) / (flatLen(toCentre) || 1);
    if ((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI > DESK.maxAngleDeg) continue;

    // Move from the near point toward the table centre: far enough to be a comfortable
    // distance from the eyes, at least the inset from the edge, and never past the centre.
    const inward = sub(plane.position, near);
    const n = flatLen(inward) || 1;
    const least = Math.min(DESK.inset, n * 0.5);
    const k = Math.min(n, Math.max(least, DESK.comfort - reach)) / n;
    const position = { x: near.x + inward.x * k, y: y + DESK.lift, z: near.z + inward.z * k };
    const back = sub(head, position);
    const place: DeskPlacement = {
      kind: 'desk',
      position,
      yaw: yawFacing({ x: back.x, y: 0, z: back.z }),
      tilt: DESK.tilt,
      scale: cardScale(head, position),
      planeId: plane.id,
    };
    const score = reach;
    if (!best || score < best.score) best = { place, score };
  }
  return best ? best.place : lapPlacement(head, forward);
}
