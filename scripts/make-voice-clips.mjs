// Makes the agent's voice clips: one public/voice/<id>.mp3 per line in src/logic/lines.ts.
//
//   node scripts/make-voice-clips.mjs                 # Windows built-in voice (free, offline)
//   node scripts/make-voice-clips.mjs --voice "Microsoft David Desktop"
//   node scripts/make-voice-clips.mjs --from <dir>    # use your own recordings: <dir>/<id>.wav|mp3
//
// Needs Windows (System.Speech) for the built-in voice, and ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const voice = opt('--voice', 'Microsoft Zira Desktop');
const from = opt('--from', null);

// Read CLIP_TEXT from the source so the clips always match the words in the app.
const src = readFileSync('src/logic/lines.ts', 'utf8');
const block = src.slice(src.indexOf('export const CLIP_TEXT = {'), src.indexOf('} as const;'));
const clips = [...block.matchAll(/^\s+'?([\w-]+)'?: '([^']+)',$/gm)].map((m) => ({ id: m[1], text: m[2] }));
if (clips.length === 0) throw new Error('no clips found in src/logic/lines.ts');

const out = 'public/voice';
mkdirSync(out, { recursive: true });
const work = join(tmpdir(), 'agentwall-voice');
mkdirSync(work, { recursive: true });

for (const { id, text } of clips) {
  let input;
  if (from) {
    input = [join(from, `${id}.wav`), join(from, `${id}.mp3`)].find((p) => existsSync(p));
    if (!input) throw new Error(`missing recording for ${id} in ${from}`);
  } else {
    input = join(work, `${id}.wav`);
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SelectVoice('${voice.replace(/'/g, "''")}')`,
      '$s.Rate = 0',
      `$s.SetOutputToWaveFile('${input.replace(/'/g, "''")}')`,
      `$s.Speak('${text.replace(/'/g, "''")}')`,
      '$s.Dispose()',
    ].join('; ');
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  }
  // Mono, 24 kHz, 48 kbps: a few KB per second, plenty for a voice.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '24000', '-b:a', '48k', join(out, `${id}.mp3`)], {
    stdio: 'inherit',
  });
  console.log(`${id}.mp3  "${text}"`);
}
if (!from) rmSync(work, { recursive: true, force: true });
console.log(`\n${clips.length} clips in ${out} (${from ? `from ${from}` : voice})`);
