/**
 * The agent's voice: the browser's own speech synthesis (free, on the device,
 * no API key). Quest Browser may have no voices installed; then this stays
 * silent and the board still shows every line. The newest line always wins, and
 * nothing is said while the microphone is recording (it would hear itself).
 */
let enabled = true;

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function setSpeechEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopSpeaking();
}

export function speechEnabled(): boolean {
  return enabled;
}

/** Pick a clear English voice if the device has several. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => /natural|neural|google|samantha|aria|jenny/i.test(v.name)) ??
    en.find((v) => /en[-_](us|gb|in)/i.test(v.lang)) ??
    en[0]
  );
}

/** Say one short line. Returns false when there is no voice (silent fallback). */
export function speak(text: string): boolean {
  if (!enabled || !speechAvailable() || !text) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // the newest line wins
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.volume = 0.9;
    const voice = pickVoice(synth.getVoices());
    if (voice) u.voice = voice;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try {
    if (speechAvailable()) window.speechSynthesis.cancel();
  } catch {
    // nothing to stop
  }
}
