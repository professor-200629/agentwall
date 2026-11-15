import { describe, expect, it } from 'vitest';
import { chooseWall, rotate, type PlaneInput, type Quat, type V3 } from '../src/logic/placement.js';
import { PlacementController, TIMING } from '../src/logic/placement-controller.js';
import {
  ANY_ANGLE,
  parsePrint,
  placeOnRememberedWall,
  SAME_WALL,
  serializePrint,
  wallPrint,
  type WallPrint,
} from '../src/logic/same-wall.js';

const S = Math.SQRT1_2;
/** Plane-space +Y (the normal) turned to world +Z. */
const FACING_PLUS_Z: Quat = { x: S, y: 0, z: 0, w: S };
const rect = (halfW: number, halfH: number) => [
  { x: -halfW, z: -halfH },
  { x: halfW, z: -halfH },
  { x: halfW, z: halfH },
  { x: -halfW, z: halfH },
];

/** A 4 m x 2.5 m wall 2 m in front of the origin (z = -2), from x = -2 to x = 2. */
const frontWall = (over: Partial<PlaneInput> = {}): PlaneInput => ({
  id: 1,
  position: { x: 0, y: 1.25, z: -2 },
  orientation: FACING_PLUS_Z,
  polygon: rect(2, 1.25),
  vertical: true,
  label: 'wall',
  ...over,
});

const head: V3 = { x: 0, y: 1.2, z: 0 };
const ahead: V3 = { x: 0, y: 0, z: -1 };
/** Looking 20° to the right of straight ahead. */
const right20: V3 = { x: Math.sin((20 * Math.PI) / 180), y: 0, z: -Math.cos((20 * Math.PI) / 180) };

const mulQ = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/**
 * A new session starts from another spot: the whole room appears turned and
 * shifted in session coordinates (WebXR puts the origin where the session starts).
 */
function moveRoom(deg: number, shift: V3) {
  const h = (deg * Math.PI) / 360;
  const q: Quat = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
  const point = (p: V3): V3 => {
    const r = rotate(q, p);
    return { x: r.x + shift.x, y: r.y + shift.y, z: r.z + shift.z };
  };
  const dir = (d: V3): V3 => rotate(q, d);
  const plane = (p: PlaneInput): PlaneInput => ({ ...p, position: point(p.position), orientation: mulQ(q, p.orientation) });
  return { point, dir, plane };
}

/** Last session: board on the front wall, 0.5 m right of centre. */
const savedBoard: V3 = { x: 0.5, y: 1.1, z: -2 + 0.02 };
const print = wallPrint(head, frontWall(), savedBoard)!;

describe('wallPrint', () => {
  it('measures the wall and the board spot in room terms', () => {
    expect(print.label).toBe('wall');
    expect(print.width).toBeCloseTo(4);
    expect(print.height).toBeCloseTo(2.5);
    expect(print.bottom).toBeCloseTo(0);
    // Facing the wall, its left end is at x = -2, so the board is 2.5 m from it.
    expect(print.fromLeft).toBeCloseTo(2.5);
    expect(print.y).toBeCloseTo(1.1);
  });

  it('gives no print for a window or a floor', () => {
    expect(wallPrint(head, frontWall({ label: 'window' }), savedBoard)).toBeNull();
    expect(wallPrint(head, frontWall({ vertical: false }), savedBoard)).toBeNull();
  });
});

describe('placeOnRememberedWall', () => {
  it('puts the board back on the same spot even when the user looks elsewhere', () => {
    const fresh = chooseWall(head, right20, [frontWall()])!;
    expect(Math.abs(fresh.position.x - 0.5)).toBeGreaterThan(0.1); // a new spot would differ
    const back = placeOnRememberedWall(head, right20, [frontWall()], print)!;
    expect(back.remembered).toBe(true);
    expect(back.position.x).toBeCloseTo(0.5);
    expect(back.position.y).toBeCloseTo(1.1);
    expect(back.position.z).toBeCloseTo(-1.98);
  });

  it('survives a new session that starts from another spot (room turned and shifted)', () => {
    const m = moveRoom(35, { x: 1.3, y: 0, z: -0.7 });
    const wall = m.plane(frontWall({ id: 7 }));
    const back = placeOnRememberedWall(m.point(head), m.dir(right20), [wall], print)!;
    const expected = m.point(savedBoard);
    expect(back).not.toBeNull();
    expect(back.position.x).toBeCloseTo(expected.x, 3);
    expect(back.position.y).toBeCloseTo(expected.y, 3);
    expect(back.position.z).toBeCloseTo(expected.z, 3);
    expect(back.planeId).toBe(7);
  });

  it('does not match a wall of another size or label', () => {
    expect(placeOnRememberedWall(head, ahead, [frontWall({ polygon: rect(2 + SAME_WALL.tolerance, 1.25) })], print)).toBeNull();
    expect(placeOnRememberedWall(head, ahead, [frontWall({ polygon: rect(2, 1.25 + SAME_WALL.tolerance) })], print)).toBeNull();
    expect(placeOnRememberedWall(head, ahead, [frontWall({ label: 'door' })], print)).toBeNull();
    // A few centimetres of re-scan noise still match.
    expect(placeOnRememberedWall(head, ahead, [frontWall({ polygon: rect(2.02, 1.23) })], print)).not.toBeNull();
  });

  it('of two same-size walls (front and back of the room) picks the one in front', () => {
    const back = frontWall({ id: 2, position: { x: 0, y: 1.25, z: 2 } });
    const p = placeOnRememberedWall(head, ahead, [back, frontWall()], print)!;
    expect(p.planeId).toBe(1);
  });

  it('gives up when the remembered wall is behind the user', () => {
    expect(placeOnRememberedWall(head, { x: 0, y: 0, z: 1 }, [frontWall()], print)).toBeNull();
  });

  it('a new session uses the old spot only when it is near the gaze (Quest test: "off-centre")', () => {
    // The old spot is 14° right of straight ahead: fine looking ahead or 20° right...
    expect(placeOnRememberedWall(head, ahead, [frontWall()], print)).not.toBeNull();
    // ...but looking 25° left it would sit ~39° off-centre, so the board is centred instead.
    const left25: V3 = { x: -Math.sin((25 * Math.PI) / 180), y: 0, z: -Math.cos((25 * Math.PI) / 180) };
    expect(placeOnRememberedWall(head, left25, [frontWall()], print)).toBeNull();
  });

  it('after a recenter the old spot comes back even when the user looks away', () => {
    const back = placeOnRememberedWall(head, { x: 1, y: 0, z: 0 }, [frontWall()], print, ANY_ANGLE)!;
    expect(back.position.x).toBeCloseTo(0.5);
    expect(back.remembered).toBe(true);
  });

  it('keeps the board inside the wall when the old spot is at its edge', () => {
    const edge: WallPrint = { ...print, fromLeft: 0.05 };
    const p = placeOnRememberedWall(head, ahead, [frontWall()], edge, ANY_ANGLE)!;
    expect(p.position.x).toBeCloseTo(-2 + (1.2 * p.scale) / 2); // board's left edge on the wall's left end
  });
});

describe('saved fingerprint', () => {
  it('round-trips and rejects anything malformed', () => {
    expect(parsePrint(serializePrint(print))).toEqual(print);
    expect(parsePrint(null)).toBeNull();
    expect(parsePrint('not json')).toBeNull();
    expect(parsePrint(JSON.stringify({ ...print, v: 2 }))).toBeNull();
    expect(parsePrint(JSON.stringify({ v: 1, ...print, width: 'wide' }))).toBeNull();
    expect(parsePrint(JSON.stringify({ v: 1, ...print, y: 1e9 }))).toBeNull();
  });
});

describe('PlacementController with a remembered wall', () => {
  const sideWall = (id: number): PlaneInput => ({
    id,
    position: { x: -2, y: 1.25, z: 0 },
    orientation: { x: 0, y: 0, z: -S, w: S }, // normal to +X
    polygon: rect(2, 1.25),
    vertical: true,
    label: 'wall',
  });
  const lookLeft: V3 = { x: -1, y: 0, z: 0 };

  it('goes straight back to the remembered spot', () => {
    const c = new PlacementController();
    c.start(0, print);
    const p = c.tick(0.1, head, right20, [frontWall()])!;
    expect(p.remembered).toBe(true);
    expect(p.position.x).toBeCloseTo(0.5);
    expect(c.settled).toBe(true);
  });

  it('a wall the user simply turns to does not pull the board over', () => {
    const c = new PlacementController();
    c.start(0, print);
    // Facing the side wall first: the remembered wall is behind the shoulder, out of view.
    const first = c.tick(0.1, head, lookLeft, [sideWall(5), frontWall()])!;
    expect(first.remembered).toBeFalsy();
    expect(c.settled).toBe(false); // still listening for late planes
    // Turning to the remembered wall (already known) must not move the board.
    expect(c.tick(1, head, ahead, [sideWall(5), frontWall()])).toBeNull();
  });

  it('a remembered wall that arrives late still wins, but only for a while', () => {
    const c = new PlacementController();
    c.start(0, print);
    c.tick(0.1, head, lookLeft, [sideWall(5)]); // only the side wall is known yet, and it is in view
    const late = c.tick(0.8, head, ahead, [sideWall(5), frontWall({ id: 9 })])!;
    expect(late.remembered).toBe(true);
    expect(late.planeId).toBe(9);

    const c2 = new PlacementController();
    c2.start(0, print);
    c2.tick(0.1, head, lookLeft, [sideWall(5)]);
    expect(c2.tick(TIMING.lateWallSeconds + 1, head, ahead, [sideWall(5), frontWall({ id: 9 })])).toBeNull();
    expect(c2.settled).toBe(true);
  });

  it('never moves the board once the user is using it', () => {
    const c = new PlacementController();
    c.start(0, print);
    c.tick(0.1, head, lookLeft, [sideWall(5)]);
    c.lock();
    expect(c.tick(0.8, head, ahead, [sideWall(5), frontWall({ id: 9 })])).toBeNull();
  });

  it('a recenter restores the remembered spot wherever the user looks', () => {
    const c = new PlacementController();
    c.start(0, print, { anyAngle: true });
    const p = c.tick(0.1, head, lookLeft, [sideWall(5), frontWall()])!;
    expect(p.remembered).toBe(true);
    expect(p.position.x).toBeCloseTo(0.5);
  });

  it('without a memory it behaves exactly as before', () => {
    const c = new PlacementController();
    c.start(0);
    const p = c.tick(0.1, head, ahead, [frontWall()])!;
    expect(p.remembered).toBeFalsy();
    expect(c.settled).toBe(true);
  });
});
