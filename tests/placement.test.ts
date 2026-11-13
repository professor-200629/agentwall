import { describe, expect, it } from 'vitest';
import {
  BOARD,
  chooseWall,
  fallbackPlacement,
  flatForward,
  PLACEMENT,
  type PlaneInput,
  type Quat,
} from '../src/logic/placement.js';
import { PlacementController, TIMING } from '../src/logic/placement-controller.js';

const S = Math.SQRT1_2;
/** Plane-space +Y (the normal) turned to world +Z: 90° about X. */
const FACING_PLUS_Z: Quat = { x: S, y: 0, z: 0, w: S };
/** Normal to world -Z. */
const FACING_MINUS_Z: Quat = { x: -S, y: 0, z: 0, w: S };
/** Normal to world +X: +Y -> +X is -90° about Z. */
const FACING_PLUS_X: Quat = { x: 0, y: 0, z: -S, w: S };
const FLOOR: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Rectangle polygon in plane space (y = 0, so x and z only). */
const rect = (halfW: number, halfH: number) => [
  { x: -halfW, z: -halfH },
  { x: halfW, z: -halfH },
  { x: halfW, z: halfH },
  { x: -halfW, z: halfH },
];

/** A 4 m wide, 2.5 m tall wall 2 m in front of the origin (at z = -2). */
const frontWall = (over: Partial<PlaneInput> = {}): PlaneInput => ({
  id: 1,
  position: { x: 0, y: 1.25, z: -2 },
  orientation: FACING_PLUS_Z,
  polygon: rect(2, 1.25),
  vertical: true,
  label: 'wall',
  ...over,
});

const seatedHead = { x: 0, y: 1.2, z: 0 };
const lookAhead = { x: 0, y: 0, z: -1 };

describe('chooseWall', () => {
  it('puts the board on the wall in front, at eye level, facing the user', () => {
    const p = chooseWall(seatedHead, lookAhead, [frontWall()]);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('wall');
    expect(p!.position.x).toBeCloseTo(0);
    expect(p!.position.y).toBeCloseTo(1.2 - PLACEMENT.belowEye);
    expect(p!.position.z).toBeCloseTo(-2 + PLACEMENT.wallGap);
    expect(p!.yaw).toBeCloseTo(0); // front faces +Z, toward the user
    expect(p!.planeId).toBe(1);
  });

  it('still faces the user when the plane normal points away from them', () => {
    const p = chooseWall(seatedHead, lookAhead, [frontWall({ orientation: FACING_MINUS_Z })]);
    expect(p).not.toBeNull();
    expect(p!.yaw).toBeCloseTo(0);
    expect(p!.position.z).toBeCloseTo(-2 + PLACEMENT.wallGap);
  });

  it('accepts an unlabelled vertical plane', () => {
    expect(chooseWall(seatedHead, lookAhead, [frontWall({ label: undefined })])).not.toBeNull();
  });

  it('ignores doors, windows, screens and wall art', () => {
    for (const label of ['door', 'window', 'screen', 'wall_art']) {
      expect(chooseWall(seatedHead, lookAhead, [frontWall({ label })])).toBeNull();
    }
  });

  it('ignores horizontal planes such as the floor', () => {
    const floor = frontWall({
      position: { x: 0, y: 0, z: -1 },
      orientation: FLOOR,
      vertical: false,
      label: 'floor',
    });
    expect(chooseWall(seatedHead, lookAhead, [floor])).toBeNull();
  });

  it('ignores a wall too narrow for the board', () => {
    expect(chooseWall(seatedHead, lookAhead, [frontWall({ polygon: rect(0.3, 1.25) })])).toBeNull();
  });

  it('ignores a wall that is too far away', () => {
    const far = frontWall({ position: { x: 0, y: 1.25, z: -(PLACEMENT.maxWallDistance + 1) } });
    expect(chooseWall(seatedHead, lookAhead, [far])).toBeNull();
  });

  it('ignores a wall behind or beside the user', () => {
    const lookRight = { x: 1, y: 0, z: 0 };
    expect(chooseWall(seatedHead, lookRight, [frontWall()])).toBeNull();
  });

  it('keeps the whole board on the wall near its edge', () => {
    const p = chooseWall({ x: 1.9, y: 1.2, z: 0 }, lookAhead, [frontWall()]);
    expect(p).not.toBeNull();
    expect(p!.position.x).toBeCloseTo(2 - BOARD.width / 2);
  });

  it('lowers the board to fit a short wall', () => {
    // 0.8 m tall wall from the floor up.
    const low = frontWall({ position: { x: 0, y: 0.4, z: -2 }, polygon: rect(2, 0.4) });
    const p = chooseWall({ x: 0, y: 1.6, z: 0 }, lookAhead, [low]);
    expect(p).not.toBeNull();
    expect(p!.position.y).toBeCloseTo(0.8 - BOARD.height / 2);
  });

  it('prefers the wall the user is looking at over a side wall', () => {
    const side: PlaneInput = {
      id: 2,
      position: { x: -1.5, y: 1.25, z: -1 },
      orientation: FACING_PLUS_X,
      polygon: rect(2, 1.25),
      vertical: true,
      label: 'wall',
    };
    expect(chooseWall(seatedHead, lookAhead, [side, frontWall()])!.planeId).toBe(1);
    const lookLeft = { x: -1, y: 0, z: -0.3 };
    expect(chooseWall(seatedHead, lookLeft, [side, frontWall()])!.planeId).toBe(2);
  });

  it('uses where the user looks along the wall, not just straight ahead', () => {
    const lookSlightlyRight = { x: 0.3, y: 0, z: -1 };
    const p = chooseWall(seatedHead, lookSlightlyRight, [frontWall()]);
    expect(p!.position.x).toBeCloseTo(0.6); // 2 m * 0.3
  });
});

describe('fallbackPlacement', () => {
  it('puts the board 1.2 m in front at eye height, facing the user', () => {
    const p = fallbackPlacement(seatedHead, lookAhead);
    expect(p.kind).toBe('fallback');
    expect(p.position).toEqual({ x: 0, y: 1.2, z: -1.2 });
    expect(Math.abs(p.yaw)).toBeCloseTo(0);
  });

  it('follows a turned head and ignores pitch', () => {
    const p = fallbackPlacement(seatedHead, { x: 1, y: -0.8, z: 0 });
    expect(p.position.x).toBeCloseTo(1.2);
    expect(p.position.y).toBeCloseTo(1.2);
    expect(p.position.z).toBeCloseTo(0);
    expect(p.yaw).toBeCloseTo(-Math.PI / 2); // faces -X, back at the user
  });

  it('copes with looking straight down', () => {
    expect(flatForward({ x: 0, y: -1, z: 0 })).toEqual({ x: 0, y: 0, z: -1 });
  });
});

describe('PlacementController', () => {
  it('does nothing until started', () => {
    const c = new PlacementController();
    expect(c.tick(10, seatedHead, lookAhead, [frontWall()])).toBeNull();
    expect(c.state).toBe('idle');
  });

  it('places on a wall as soon as one is seen', () => {
    const c = new PlacementController();
    c.start(0);
    expect(c.tick(0.1, seatedHead, lookAhead, [frontWall()])!.kind).toBe('wall');
    expect(c.state).toBe('wall');
    // Final: no more moves.
    expect(c.tick(0.2, seatedHead, { x: 1, y: 0, z: 0 }, [frontWall()])).toBeNull();
  });

  it('waits, then falls back when no wall shows up', () => {
    const c = new PlacementController();
    c.start(100);
    expect(c.tick(100 + TIMING.searchSeconds - 0.1, seatedHead, lookAhead, [])).toBeNull();
    expect(c.state).toBe('searching');
    const p = c.tick(100 + TIMING.searchSeconds, seatedHead, lookAhead, []);
    expect(p!.kind).toBe('fallback');
    expect(c.state).toBe('fallback');
    // Falls back once, not every frame.
    expect(c.tick(100 + TIMING.searchSeconds + 0.1, seatedHead, lookAhead, [])).toBeNull();
  });

  it('moves from the fallback to a wall that appears soon after', () => {
    const c = new PlacementController();
    c.start(0);
    c.tick(3, seatedHead, lookAhead, []);
    expect(c.state).toBe('fallback');
    expect(c.tick(5, seatedHead, lookAhead, [frontWall()])!.kind).toBe('wall');
  });

  it('stays on the fallback when a wall appears too late', () => {
    const c = new PlacementController();
    c.start(0);
    c.tick(3, seatedHead, lookAhead, []);
    expect(c.tick(TIMING.lateWallSeconds + 1, seatedHead, lookAhead, [frontWall()])).toBeNull();
    expect(c.state).toBe('fallback');
  });

  it('falls back when the only wall is behind the user', () => {
    const c = new PlacementController();
    c.start(0);
    const lookBack = { x: 0, y: 0, z: 1 };
    expect(c.tick(TIMING.searchSeconds, seatedHead, lookBack, [frontWall()])!.kind).toBe('fallback');
  });

  it('can be restarted to search again', () => {
    const c = new PlacementController();
    c.start(0);
    c.tick(0.1, seatedHead, lookAhead, [frontWall()]);
    c.start(50);
    expect(c.state).toBe('searching');
    expect(c.current).toBeNull();
  });
});
