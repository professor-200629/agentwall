/**
 * Tiny synthesised sounds (Web Audio), so there are no audio files to load.
 * Browsers only allow audio after a user gesture: call unlockAudio() from the
 * "Enter mixed reality" click.
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null; // no audio available; the app works silently
  }
}

function tone(freq: number, start: number, length: number, gain: number): void {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** Two rising notes: "approved, into the outbox". */
export function playApproved(): void {
  tone(660, 0, 0.25, 0.18);
  tone(990, 0.12, 0.45, 0.16);
}

/** Soft tick when a slot is swapped. */
export function playTick(): void {
  tone(520, 0, 0.08, 0.08);
}
