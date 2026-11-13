/**
 * Voice input: record a few seconds with getUserMedia + MediaRecorder, then
 * send the audio to Whisper (Groq) through our Worker.
 *
 * The Web Speech API is not used: it may not exist in Quest Browser. Every
 * failure returns a short message instead of throwing; the preset chips are
 * always there as the fallback.
 */

export const MAX_RECORD_MS = 5000;
const TRANSCRIBE_TIMEOUT_MS = 8000;

export type VoiceState = 'idle' | 'listening' | 'transcribing';

export class VoiceInput {
  state: VoiceState = 'idle';
  /** Seconds left while listening, for the chip label. */
  remaining = 0;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;

  constructor(
    private agentUrl: string,
    private onText: (text: string) => void,
    private onError: (message: string) => void,
    private onChange: () => void,
  ) {}

  get available(): boolean {
    return Boolean(
      this.agentUrl &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined',
    );
  }

  /** Why voice is not available, for the board. */
  get unavailableReason(): string {
    if (!this.agentUrl) return 'Voice needs the AI service; use the chips';
    return 'This browser cannot record audio; use the chips';
  }

  tick(): void {
    if (this.state !== 'listening') return;
    const left = Math.max(0, Math.ceil((MAX_RECORD_MS - (performance.now() - this.startedAt)) / 1000));
    if (left !== this.remaining) {
      this.remaining = left;
      this.onChange();
    }
  }

  /** Pinch the mic chip: start listening, or stop early if already listening. */
  async toggle(): Promise<void> {
    if (this.state === 'listening') {
      this.stop();
      return;
    }
    if (this.state !== 'idle') return;
    if (!this.available) {
      this.onError(this.unavailableReason);
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.onError('Microphone blocked; use the chips');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => void this.finish();
    this.recorder.start();
    this.startedAt = performance.now();
    this.remaining = Math.ceil(MAX_RECORD_MS / 1000);
    this.state = 'listening';
    this.onChange();
    this.stopTimer = setTimeout(() => this.stop(), MAX_RECORD_MS);
  }

  private stop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private async finish(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const type = this.recorder?.mimeType || 'audio/webm';
    this.recorder = null;
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    if (blob.size < 1000) {
      this.reset();
      this.onError('Didn’t catch that; try again or use a chip');
      return;
    }
    this.state = 'transcribing';
    this.onChange();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append('audio', blob, type.includes('mp4') ? 'speech.m4a' : 'speech.webm');
      const res = await fetch(`${this.agentUrl.replace(/\/$/, '')}/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? '').trim();
      this.reset();
      if (!res.ok || !text) this.onError('Didn’t catch that; try again or use a chip');
      else this.onText(text);
    } catch {
      this.reset();
      this.onError('Voice service unreachable; use the chips');
    } finally {
      clearTimeout(timer);
    }
  }

  private reset(): void {
    this.state = 'idle';
    this.remaining = 0;
    this.onChange();
  }
}
