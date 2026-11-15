/**
 * When to place the board. Plain TypeScript (no XR), driven by the XR system
 * every frame and unit-tested in Node.
 *
 *   idle ──start()──▶ searching ──wall seen──▶ wall (final)
 *                        │
 *                        └─ no wall after searchSeconds ─▶ fallback
 *                                                          │
 *              wall seen within lateWallSeconds of start ──┘──▶ wall
 *
 * Quest can report planes a moment after the session starts, so a late wall
 * still wins for a short while. After that the board stays where it is, so it
 * never jumps around while the user works.
 *
 * Same wall next time: with a remembered wall (same-wall.ts) the board goes
 * back to its old spot when that wall is in front. If the board first lands on
 * another wall, it moves only when the remembered wall is a plane that arrives
 * LATE (not one that was already known), so turning your head never moves it.
 */
import {
  chooseWall,
  fallbackPlacement,
  type PlaneInput,
  type Placement,
  type V3,
} from './placement.js';
import { ANY_ANGLE, placeOnRememberedWall, type WallPrint } from './same-wall.js';

export type PlacementState = 'idle' | 'searching' | 'fallback' | 'wall';

export const TIMING = {
  searchSeconds: 2.5,
  lateWallSeconds: 15,
} as const;

export class PlacementController {
  state: PlacementState = 'idle';
  current: Placement | null = null;
  private startedAt = 0;
  /** Set once the user starts using the board: it must not jump to a late wall. */
  private locked = false;
  /** The wall remembered from last time, if any. */
  private memory: WallPrint | null = null;
  /** Plane ids known when the board landed on a different wall than the remembered one. */
  private knownAtLanding: Set<number> | null = null;
  /** After a recenter: put the board back on its spot wherever the user looks. */
  private anyAngle = false;

  /**
   * @param memory the wall remembered from last time, or null
   * @param opts.anyAngle restore the remembered spot even if it is not in view
   *   (the headset was recentered; the room did not move)
   */
  start(now: number, memory: WallPrint | null = null, opts: { anyAngle?: boolean } = {}): void {
    this.state = 'searching';
    this.current = null;
    this.startedAt = now;
    this.locked = false;
    this.memory = memory;
    this.knownAtLanding = null;
    this.anyAngle = !!opts.anyAngle;
  }

  /** The user is interacting with the board: keep it where it is (code review 14 Nov). */
  lock(): void {
    if (this.current) this.locked = true;
  }

  stop(): void {
    this.state = 'idle';
    this.current = null;
  }

  /** True when tick() can no longer move the board (the caller may stop calling it). */
  get settled(): boolean {
    if (this.state === 'idle') return true;
    if (this.locked) return true;
    return this.state === 'wall' && this.knownAtLanding === null;
  }

  /**
   * Returns a new placement when the board should move this frame, else null.
   * `now` is in seconds.
   */
  tick(now: number, head: V3, forward: V3, planes: ReadonlyArray<PlaneInput>): Placement | null {
    if (this.state === 'idle' || this.locked) return null;
    const elapsed = now - this.startedAt;
    if (elapsed > TIMING.lateWallSeconds) this.knownAtLanding = null;
    if (this.settled) return null;

    if (elapsed <= TIMING.lateWallSeconds && planes.length > 0) {
      if (this.memory) {
        // Already on another wall: only planes that arrived since then may match.
        const known = this.knownAtLanding;
        const fresh = known ? planes.filter((p) => !known.has(p.id)) : planes;
        const back =
          fresh.length > 0
            ? placeOnRememberedWall(head, forward, fresh, this.memory, this.anyAngle ? ANY_ANGLE : undefined)
            : null;
        if (back) {
          this.state = 'wall';
          this.current = back;
          this.knownAtLanding = null;
          return back;
        }
      }
      if (this.state !== 'wall') {
        const wall = chooseWall(head, forward, planes);
        if (wall) {
          this.state = 'wall';
          this.current = wall;
          this.knownAtLanding = this.memory ? new Set(planes.map((p) => p.id)) : null;
          return wall;
        }
      }
    }

    if (this.state === 'searching' && elapsed >= TIMING.searchSeconds) {
      this.state = 'fallback';
      this.current = fallbackPlacement(head, forward);
      return this.current;
    }
    return null;
  }
}
