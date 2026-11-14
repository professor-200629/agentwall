/**
 * Where the invite card goes for the decision: on the user's real table/desk
 * when one is detected in front of them, otherwise just above their lap.
 * "The wall thinks, the desk decides." Plain TypeScript, unit-tested.
 */
import { flatForward, rotate, yawFacing, type PlaneInput, type V3 } from './placement.js';

export interface DeskPlacement {
  kind: 'desk' | 'lap';
  /** Card centre in world space. */
  position: V3;
  /** Rotation about +Y so the card faces the user. */
  yaw: number;
  /** Lean back (radians) so the card tilts up toward the user's eyes. */
  tilt: number;
  planeId?: number;
}

export const DESK = {
  /** Table tops between these heights (m) count; floors, couches and shelves don't. */
  minHeight: 0.55,
  maxHeight: 1.15,
  /** Nearest table edge must be within this horizontal reach (m) and in front. */
  maxReach: 1.0,
  maxAngleDeg: 70,
  /** Card sits this far in from the near edge, and this high above the top (m). */
  inset: 0.14,
  lift: 0.06,
  tilt: (35 * Math.PI) / 180,
  /** Lap fallback: in front of and below the eyes (m). */
  lapForward: 0.45,
  lapBelowEye: 0.35,
  lapTilt: (40 * Math.PI) / 180,
};

const TABLE_LABELS = new Set(['table', 'desk']);

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const flatLen = (a: V3) => Math.hypot(a.x, a.z);

export function lapPlacement(head: V3, forward: V3): DeskPlacement {
  const f = flatForward(forward);
  const position = {
    x: head.x + f.x * DESK.lapForward,
    y: head.y - DESK.lapBelowEye,
    z: head.z + f.z * DESK.lapForward,
  };
  return { kind: 'lap', position, yaw: yawFacing({ x: -f.x, y: 0, z: -f.z }), tilt: DESK.lapTilt };
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

    // Move from the near point toward the table centre, so the card sits on the table.
    const inward = sub(plane.position, near);
    const n = flatLen(inward) || 1;
    const k = Math.min(DESK.inset, n * 0.5) / n;
    const position = { x: near.x + inward.x * k, y: y + DESK.lift, z: near.z + inward.z * k };
    const back = sub(head, position);
    const place: DeskPlacement = {
      kind: 'desk',
      position,
      yaw: yawFacing({ x: back.x, y: 0, z: back.z }),
      tilt: DESK.tilt,
      planeId: plane.id,
    };
    const score = reach;
    if (!best || score < best.score) best = { place, score };
  }
  return best ? best.place : lapPlacement(head, forward);
}
