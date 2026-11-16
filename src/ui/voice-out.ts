/**
 * The agent's voice. Plays a short pre-recorded clip (public/voice/<id>.mp3)
 * through Web Audio, the same path as the chimes, because Quest Browser's
 * speechSynthesis stays silent (first real Quest test, 16 Nov). If a clip cannot
 * load, the browser's own voice is the fallback (works on desktop Chrome).
 * The newest line always wins, and nothing is said while the mic is recording.
 */
import type { ClipId, SpokenLine } from '../logic/lines.js';
import { CLIP_IDS } from '../logic/lines.js';
import { audioContext } from './sound.js';

let enabled = true;
const clips = new Map<ClipId, Promise<AudioBuffer | null>>();
const loaded = new Set<ClipId>();
let current: AudioBufferSourceNode | null = null;
let request = 0;
let lastPlayed: ClipId | null = null;

export function setSpeechEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopSpeaking();
}

export function speechEnabled(): boolean {
  return enabled;
}

function loadClip(ctx: AudioContext, id: ClipId): Promise<AudioBuffer | null> {
  let p = clips.get(id);
  if (!p) {
    p = fetch(`voice/${id}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        loaded.add(id);
        return buf;
      })
      .catch(() => null);
    clips.set(id, p);
  }
  return p;
}

/** Fetch every clip once audio is allowed, so the first line has no delay. */
export function preloadClips(): void {
  const ctx = audioContext();
  if (!ctx) return;
  for (const id of CLIP_IDS) void loadClip(ctx, id);
}

function play(ctx: AudioContext, buf: AudioBuffer, id: ClipId): void {
  stopClip();
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  src.onended = () => {
    if (current === src) current = null;
  };
  src.start();
  current = src;
  lastPlayed = id;
}

/** Say one line. Returns false when there is no way to make sound yet. */
export function speak(line: SpokenLine): boolean {
  if (!enabled) return false;
  const mine = ++request;
  const ctx = audioContext();
  if (ctx) {
    void loadClip(ctx, line.id).then((buf) => {
      if (mine !== request) return; // a newer line came first
      if (buf) play(ctx, buf, line.id);
      else speakWithBrowser(line.text);
    });
    return true;
  }
  return speakWithBrowser(line.text);
}

function stopClip(): void {
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = null;
}

export function stopSpeaking(): void {
  request++;
  stopClip();
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch {
    // nothing to stop
  }
}

/** Fallback: the browser's own voice (desktop Chrome has one; Quest Browser stays silent). */
function speakWithBrowser(text: string): boolean {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    const en = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    const voice = en.find((v) => /natural|neural|google|aria|jenny/i.test(v.name)) ?? en[0];
    if (voice) u.voice = voice;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** Test hook: which clips are loaded and which one played last. */
export function clipState(): { loaded: number; total: number; lastPlayed: ClipId | null } {
  return { loaded: loaded.size, total: CLIP_IDS.length, lastPlayed };
}
