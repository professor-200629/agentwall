/**
 * Pinch-and-hold to approve. Plain TypeScript, driven once per frame with
 * "is the invite pressed right now?" and unit-tested in Node.
 *
 * - Holding fills progress from 0 to 1 over `seconds`.
 * - Real hand rays flicker: a pinch can drop for a frame or two when the ray
 *   wobbles off the card. Gaps up to `graceSeconds` freeze the ring instead
 *   of cancelling it.
 * - Letting go for longer drains the ring quickly (it does not snap to 0, so
 *   the user sees it was released).
 * - On reaching 1 it fires 'complete' once. It will not fire again until the
 *   pinch is released, so one long hold cannot approve two invites in a row.
 */

export const HOLD = {
  seconds: 1.0,
  graceSeconds: 0.15,
  drainPerSecond: 3,
} as const;

/** 'released' is reported once, when a hold that had started is let go before it completed. */
export type HoldEvent = 'idle' | 'holding' | 'complete' | 'released';

export class HoldToApprove {
  /** 0..1, for drawing the ring. */
  progress = 0;
  private gap = 0;
  private waitForRelease = false;
  private released = false;

  constructor(private readonly cfg: { seconds: number; graceSeconds: number; drainPerSecond: number } = HOLD) {}

  /**
   * @param dt seconds since the last frame (clamped to 0.1 s so a stalled
   *   frame cannot complete a hold on its own)
   * @param pressed the target is pinched this frame
   * @param enabled approval is possible (there is an invite needing approval)
   */
  update(dt: number, pressed: boolean, enabled: boolean): HoldEvent {
    const step = Math.min(Math.max(dt, 0), 0.1);
    let endedEarly = false;
    if (!pressed) {
      this.gap += step;
      if (this.gap > this.cfg.graceSeconds) {
        this.waitForRelease = false;
        // A real release ends this hold. The ring still drains so you see it, but the
        // next pinch starts from nothing: one approval is one continuous hold.
        endedEarly = !this.released && this.progress > 0;
        this.released = true;
      }
    }

    if (!enabled) {
      this.progress = 0;
      return 'idle';
    }
    if (endedEarly) {
      this.progress = Math.max(0, this.progress - step * this.cfg.drainPerSecond);
      return 'released';
    }

    if (pressed) {
      this.gap = 0;
      if (this.waitForRelease) return 'idle';
      if (this.released) {
        this.released = false;
        this.progress = 0;
      }
      this.progress = Math.min(1, this.progress + step / this.cfg.seconds);
      if (this.progress >= 1) {
        this.progress = 0;
        this.waitForRelease = true;
        return 'complete';
      }
      return 'holding';
    }

    if (this.progress > 0 && this.gap <= this.cfg.graceSeconds) return 'holding';
    this.progress = Math.max(0, this.progress - step * this.cfg.drainPerSecond);
    return 'idle';
  }

  /** Ignore the current pinch until it is released (e.g. the pinch that pressed Unsend). */
  requireRelease(): void {
    this.progress = 0;
    this.waitForRelease = true;
  }

  /** Drop any partial hold (e.g. the invite changed under the user's fingers). */
  reset(): void {
    this.progress = 0;
    this.gap = 0;
  }

  /**
   * Cancel the hold for good: what was on the card changed, a conflict arrived or
   * hand tracking was lost. The pinch still down must be let go before a new hold counts.
   */
  cancel(): void {
    this.progress = 0;
    this.gap = 0;
    this.waitForRelease = true;
  }
}
