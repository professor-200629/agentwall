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
 */
import {
  chooseWall,
  fallbackPlacement,
  type PlaneInput,
  type Placement,
  type V3,
} from './placement.js';

export type PlacementState = 'idle' | 'searching' | 'fallback' | 'wall';

export const TIMING = {
  searchSeconds: 2.5,
  lateWallSeconds: 15,
} as const;

export class PlacementController {
  state: PlacementState = 'idle';
  current: Placement | null = null;
  private startedAt = 0;

  start(now: number): void {
    this.state = 'searching';
    this.current = null;
    this.startedAt = now;
  }

  stop(): void {
    this.state = 'idle';
    this.current = null;
  }

  /**
   * Returns a new placement when the board should move this frame, else null.
   * `now` is in seconds.
   */
  tick(now: number, head: V3, forward: V3, planes: ReadonlyArray<PlaneInput>): Placement | null {
    if (this.state === 'idle' || this.state === 'wall') return null;
    const elapsed = now - this.startedAt;

    if (elapsed <= TIMING.lateWallSeconds && planes.length > 0) {
      const wall = chooseWall(head, forward, planes);
      if (wall) {
        this.state = 'wall';
        this.current = wall;
        return wall;
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
