import { describe, expect, it } from 'vitest';
import { PALM, palmNormal, PalmSummon, palmTowardFace, type P3 } from '../src/logic/palm.js';

// A right hand, palm DOWN, fingers forward (-Z): thumb/index side is to the left (-X).
const wrist: P3 = { x: 0, y: 1.0, z: -0.3 };
const rIndex: P3 = { x: -0.02, y: 1.0, z: -0.38 };
const rPinky: P3 = { x: 0.03, y: 1.0, z: -0.37 };
// The left hand is the mirror image.
const lIndex: P3 = { x: 0.02, y: 1.0, z: -0.38 };
const lPinky: P3 = { x: -0.03, y: 1.0, z: -0.37 };
const head: P3 = { x: 0, y: 1.4, z: 0 };
const open = { thumb: { x: -0.06, y: 1.0, z: -0.36 }, index: { x: -0.02, y: 1.0, z: -0.46 } };
const up: P3 = { x: 0, y: 0.9, z: -0.3 }; // fingers pointing up
const down: P3 = { x: 0, y: -0.9, z: -0.3 }; // fingers pointing down (aiming at the desk)

describe('palm direction from three joints', () => {
  it('a palm-down right hand faces down; the left hand too (mirrored)', () => {
    expect(palmNormal(wrist, rIndex, rPinky, 'right').y).toBeCloseTo(-1, 1);
    expect(palmNormal(wrist, lIndex, lPinky, 'left').y).toBeCloseTo(-1, 1);
  });

  it('turned over (palm up), the normal points up', () => {
    // Rotating the right hand 180° about its forward axis swaps the index/pinky sides.
    expect(palmNormal(wrist, { ...rIndex, x: 0.02 }, { ...rPinky, x: -0.03 }, 'right').y).toBeCloseTo(1, 1);
  });
});

describe('palm toward the face', () => {
  const toFace = (from: P3): P3 => {
    const d = { x: head.x - from.x, y: head.y - from.y, z: head.z - from.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  };

  it('counts an open palm held toward the eyes', () => {
    expect(palmTowardFace(wrist, toFace(wrist), head, open.thumb, open.index, up)).toBe(true);
  });

  it('not when the palm faces away, the hand is pinching, or the hand is too far', () => {
    const away = toFace(wrist);
    expect(palmTowardFace(wrist, { x: -away.x, y: -away.y, z: -away.z }, head, open.thumb, open.index, up)).toBe(false);
    expect(palmTowardFace(wrist, toFace(wrist), head, open.index, { ...open.index, x: open.index.x + 0.01 }, up)).toBe(false);
    const far: P3 = { x: 0, y: 1.0, z: -1.2 };
    expect(palmTowardFace(far, toFace(far), head, open.thumb, open.index, up)).toBe(false);
  });

  it('not with the fingers pointing down (aiming the ray at the desk card)', () => {
    expect(palmTowardFace(wrist, toFace(wrist), head, open.thumb, open.index, down)).toBe(false);
  });
});

describe('hold for a second to call the board', () => {
  it('summons once after holding, then needs a release and a cooldown', () => {
    const s = new PalmSummon();
    let summonedAt = -1;
    for (let i = 0; i < 30 && summonedAt < 0; i++) if (s.update(0.05, true) === 'summon') summonedAt = (i + 1) * 0.05;
    expect(summonedAt).toBeGreaterThanOrEqual(PALM.holdSeconds - 0.001); // not before a full second
    expect(summonedAt).toBeLessThan(PALM.holdSeconds + 0.1);
    expect(s.update(0.05, true)).toBe('idle'); // still holding: no second summon
    s.update(0.05, false); // release
    expect(s.update(0.05, true)).toBe('idle'); // cooldown
  });

  it('a short glance at the palm does nothing', () => {
    const s = new PalmSummon();
    for (let i = 0; i < 8; i++) expect(s.update(0.05, true)).toBe('charging'); // 0.4 s
    s.update(0.05, false);
    expect(s.progress).toBeLessThan(0.4);
  });
});
