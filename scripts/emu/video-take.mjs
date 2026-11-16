// Plays the demo video's sequence in Meta's emulator, with real emulated hand pinches
// and pauses, so the take can be recorded in one go with any screen recorder.
//
//   1. npm run dev                      (the emulator window opens; put it in front, full size)
//   2. start your screen recorder on that window (Windows: Win+Alt+R)
//   3. node scripts/emu/video-take.mjs  (about 85 seconds; do not touch the mouse)
//
// SLOW=1.3 stretches every pause (more room for the voice-over). AI=1 adds the spoken-limit
// shot with a canned answer (label it "simulated answer" in the video, or say the sentence
// yourself on a headset instead). What you see is the real app; only the hand is emulated.
import { execFileSync } from 'node:child_process';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const o = JSON.parse(execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 }));
  if (o.ok === false) throw new Error(o.error?.message ?? 'failed');
  return o.data;
}
const xr = (action, input = {}) => cli(['xr', action], input);
function hook(fn, ...args) {
  process.env.AGENTWALL_CALL = JSON.stringify({ fn, args });
  return cli(['browser', 'run', 'scripts/emu/call.mjs']).result;
}
function evalPage(code) {
  process.env.AGENTWALL_PAGE = JSON.stringify({ do: 'eval', code });
  return cli(['browser', 'run', 'scripts/emu/page.mjs']).result;
}
const SLOW = Number(process.env.SLOW ?? 1);
const beat = (s) => new Promise((r) => setTimeout(r, s * 1000 * SLOW));
const t0 = Date.now();
const say = (shot) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${shot}`);

const SEAT = { x: 0, y: 1.2, z: 0 };
let head = { ...SEAT };
/** Move the head smoothly to `pos`, looking at `target` (no jump cuts in the recording). */
function glide(pos, target, seconds = 1.1) {
  const d = { x: target.x - pos.x, y: target.y - pos.y, z: target.z - pos.z };
  const yaw = (Math.atan2(-d.x, -d.z) * 180) / Math.PI;
  const pitch = (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
  xr('animate-to', { device: 'headset', position: pos, orientation: { pitch, yaw, roll: 0 }, duration: seconds });
  head = { ...pos };
}
/** Seated, looking at the wall. */
function seat() {
  const b = hook('board').position;
  glide(SEAT, { x: b[0], y: b[1], z: b[2] });
}
/** Lean in: the wall from `dist` metres, aimed `dy` above the board's centre. */
function lean(dist, dy = 0) {
  const b = hook('board').position;
  glide({ x: b[0], y: b[1] + dy, z: b[2] + dist }, { x: b[0], y: b[1] + dy, z: b[2] });
}
/** Look down at the card on the desk. */
function deskView() {
  const d = hook('desk').position;
  glide({ x: d[0], y: d[1] + 0.4, z: d[2] + 0.28 }, { x: d[0], y: d[1], z: d[2] });
}
function aim(name) {
  const t = hook('targets')[name];
  // The hand rests low and to the right of wherever the head is: a relaxed, seated pinch.
  xr('animate-to', { device: 'hand-right', position: { x: head.x + 0.18, y: head.y - 0.22, z: head.z - 0.3 }, duration: 0.3 });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
async function pinch(name) {
  aim(name);
  await beat(0.6);
  xr('select', { device: 'hand-right', duration: 0.25 });
}

// ---------- a clean board, entered, seated ----------
cli(['browser', 'reload']);
await beat(3.5 / SLOW);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await beat(3.5 / SLOW);
try { xr('enter'); } catch {}
await beat(1.5 / SLOW);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
xr('set-transform', { device: 'headset', position: SEAT, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('simulateNoPlanes', false);
hook('setLateWallSeconds', 90);
hook('restart');
await beat(3 / SLOW);
hook('setHoldSeconds', 1.4); // a hold long enough to see the ring fill on a recording
hook('setUnsendSeconds', 5);
if (process.env.AI === '1') {
  hook('fakeAi', { intent: 'rule', rule: { after: '15:00', before: null, day: null, notDays: [] }, slotId: null, reason: '', body: '' });
}
console.log('\nRecording should be running now.\n');

say('1  seat view: the board on the wall, one card: "Try it"');
await beat(3);
lean(1.0);
await beat(2);
say('2  pinch "Try it": the labelled example changes the week over an approved call');
await pinch('replan:yes');
await beat(2.5);
say('3  the evidence: old time crossed out + CONFLICT, the NEW · EXAMPLE block beside it, the reason in the bar');
lean(0.62, 0.12);
await beat(5);
say('4  look down: the old invite on the desk, BLOCKED');
deskView();
await beat(4);
say('5  back to the wall: pinch "Wed 5:30 PM": a preview appears; the old conflict stays');
lean(0.95);
await beat(1);
await pinch('cand0');
await beat(4);
say('6  the card flew to the desk: WAS Tue 1:00 PM -> NOW Wed 5:30 PM, one trade-off');
deskView();
await beat(4.5);
say('7  change your mind: pinch "Thu 1:00 PM": the preview moves, nothing was approved');
lean(0.95);
await beat(0.8);
await pinch('cand1');
await beat(3.5);
if (process.env.AI === '1') {
  say('7b a spoken limit: "Could we push it past three o\'clock?" (canned answer here)');
  await hook('heard', "Could we push it past three o'clock?");
  lean(0.62, 0.12);
  await beat(4.5);
  lean(0.95);
  await pinch('cand1');
  await beat(3);
}
say('8  hold the card: the ring fills and says what it approves');
deskView();
await beat(1.5);
aim('invite');
await beat(0.8);
xr('set-select-value', { device: 'hand-right', value: 1 });
await new Promise((r) => setTimeout(r, 2400));
xr('set-select-value', { device: 'hand-right', value: 0 });
say('9  approved: 5 seconds to Unsend, then the receipt');
await beat(7.5);
say('10 the wall: the new time in gold; the outbox keeps the old one as REPLACED');
lean(0.95, -0.08);
await beat(5);
say('11 the start page: the old item has no email draft, no calendar file, no copy');
try { xr('exit'); } catch {}
await beat(1.5);
evalPage(`(document.getElementById('intro').hidden = false, document.getElementById('sent-box').scrollIntoView({ block: 'center' }), 1)`);
await beat(6);
if (process.env.AI === '1') hook('fakeAi', null);
say('end. Stop the recording.');
