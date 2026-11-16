import { describe, expect, it } from 'vitest';
import { along, centreFromGrab, DRAG, facing, pushPull, snapToWall } from '../src/logic/drag.js';
import { BOARD, PLACEMENT, type PlaneInput } from '../src/logic/placement.js';

const head = { x: 0, y: 1.2, z: 0 };

/** A wall 4 m wide and 2.6 m high, 2 m in front of the head, facing it. */
const wall = (over: Partial<PlaneInput> = {}): PlaneInput => ({
  id: 3,
  position: { x: 0, y: 1.3, z: -2 },
  // The plane's +Y is its normal: turn +Y to +Z (90 degrees about +X).
  orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
  polygon: [
    { x: -2, z: -1.3 },
    { x: 2, z: -1.3 },
    { x: 2, z: 1.3 },
    { x: -2, z: 1.3 },
  ],
  vertical: true,
  label: 'wall',
  ...over,
});

describe('grab and move: following the hand ray', () => {
  it('a still hand keeps the distance; pushing away sends it farther, pulling brings it closer', () => {
    expect(pushPull(1.2, 0.4, 0.4, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBeCloseTo(1.2);
    expect(pushPull(1.2, 0.4, 0.55, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBeCloseTo(2.1); // 15 cm of hand = 90 cm of board
    expect(pushPull(1.2, 0.4, 0.3, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBeCloseTo(0.6);
    // Never through the user and never out of the room.
    expect(pushPull(1.2, 0.4, 0.0, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBe(DRAG.boardMin);
    expect(pushPull(1.2, 0.4, 2.0, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBe(DRAG.boardMax);
    // The card moves more gently and stays near.
    expect(pushPull(0.8, 0.4, 0.5, DRAG.cardGain, DRAG.cardMin, DRAG.cardMax)).toBeCloseTo(1.05);
    expect(pushPull(0.8, 0.4, 0.9, DRAG.cardGain, DRAG.cardMin, DRAG.cardMax)).toBe(DRAG.cardMax);
    // A mouse has no hand distance (0 and 0): the distance stays; nonsense input cannot break it.
    expect(pushPull(1.5, 0, 0, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBe(1.5);
    expect(pushPull(1.5, Number.NaN, 0.3, DRAG.boardGain, DRAG.boardMin, DRAG.boardMax)).toBe(1.5);
  });

  it('the grabbed point stays on the ray at that distance', () => {
    const p = along({ x: 0.2, y: 1, z: -0.3 }, { x: 0.2, y: 1, z: -1.3 }, 2);
    expect(p).toEqual({ x: 0.2, y: 1, z: -2.3 });
    const q = along({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: -4 }, 10);
    expect(q.x).toBeCloseTo(6);
    expect(q.z).toBeCloseTo(-8);
    // A degenerate ray falls back to straight ahead instead of NaN.
    expect(along({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 2)).toEqual({ x: 1, y: 1, z: -1 });
  });

  it('the board turns to face you wherever you drag it', () => {
    expect(facing({ x: 0, y: 1, z: -2 }, head)).toBeCloseTo(0); // straight ahead: front points along +Z
    expect(facing({ x: -2, y: 1, z: 0 }, head)).toBeCloseTo(Math.PI / 2); // on your left: front points along +X
    expect(facing({ x: 2, y: 1, z: 0 }, head)).toBeCloseTo(-Math.PI / 2);
    expect(facing({ x: 0, y: 3, z: 0 }, head)).toBe(0); // straight above: no spin
  });

  it('the thing does not jump under the hand: the pinched point of the bar stays under the ray', () => {
    // The bar is 50 cm below the board centre; you pinched it 10 cm right of its middle.
    const target = { x: 0.4, y: 0.7, z: -1.5 };
    const c = centreFromGrab(target, 0, 0.1, -0.5, 1);
    expect(c.x).toBeCloseTo(0.3);
    expect(c.y).toBeCloseTo(1.2);
    expect(c.z).toBeCloseTo(-1.5);
    // Turned 90 degrees (front along +X), "right" on the board is world -Z.
    const turned = centreFromGrab(target, Math.PI / 2, 0.1, -0.5, 1);
    expect(turned.x).toBeCloseTo(0.4);
    expect(turned.z).toBeCloseTo(-1.4);
    // A board drawn larger has its bar farther from its centre.
    expect(centreFromGrab(target, 0, 0, -0.5, 1.4).y).toBeCloseTo(1.4);
  });
});

describe('grab and move: letting the board go near a real wall', () => {
  it('within reach of a wall it snaps onto it, facing the room', () => {
    const p = snapToWall({ x: 0.5, y: 1.3, z: -1.8 }, head, [wall()], 1)!;
    expect(p.kind).toBe('wall');
    expect(p.planeId).toBe(3);
    expect(p.position.x).toBeCloseTo(0.5);
    expect(p.position.y).toBeCloseTo(1.3);
    expect(p.position.z).toBeCloseTo(-2 + PLACEMENT.wallGap);
    expect(p.yaw).toBeCloseTo(0); // front points along +Z, at the user
    expect(p.distance).toBeCloseTo(Math.hypot(0.5, 0.1, 2 - PLACEMENT.wallGap));
  });

  it('farther from the wall than the snap distance it floats where you left it', () => {
    expect(snapToWall({ x: 0, y: 1.3, z: -2 + DRAG.snap + 0.05 }, head, [wall()], 1)).toBeNull();
    expect(snapToWall({ x: 0, y: 1.3, z: -1.0 }, head, [wall()], 1)).toBeNull();
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [], 1)).toBeNull(); // no room data at all
  });

  it('pushed slightly through the wall it still lands on the room side', () => {
    const p = snapToWall({ x: 0, y: 1.3, z: -2.2 }, head, [wall()], 1)!;
    expect(p.position.z).toBeCloseTo(-2 + PLACEMENT.wallGap);
  });

  it('it stays inside the wall edges, and a wall too small for the board is not used', () => {
    const corner = snapToWall({ x: 1.9, y: 2.5, z: -1.9 }, head, [wall()], 1)!;
    expect(corner.position.x).toBeCloseTo(2 - BOARD.width / 2);
    expect(corner.position.y).toBeCloseTo(2.6 - BOARD.height / 2);
    const narrow = wall({ polygon: [{ x: -0.4, z: -1.3 }, { x: 0.4, z: -1.3 }, { x: 0.4, z: 1.3 }, { x: -0.4, z: 1.3 }] });
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [narrow], 1)).toBeNull();
    // A wall that fits the board at 1x but not at 1.4x (a far board is drawn larger).
    const tight = wall({ polygon: [{ x: -0.7, z: -1.3 }, { x: 0.7, z: -1.3 }, { x: 0.7, z: 1.3 }, { x: -0.7, z: 1.3 }] });
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [tight], 1)).not.toBeNull();
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [tight], 1.4)).toBeNull();
  });

  it('only real walls: not a door, a window or a table; and the nearest of two walls wins', () => {
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [wall({ label: 'door' })], 1)).toBeNull();
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [wall({ vertical: false })], 1)).toBeNull();
    const nearer = wall({ id: 9, position: { x: 0, y: 1.3, z: -1.95 } });
    expect(snapToWall({ x: 0, y: 1.3, z: -1.9 }, head, [wall(), nearer], 1)!.planeId).toBe(9);
  });
});
