// Plays the demo video's sequence in Meta's emulator, with scripted hand pinches and
// pauses, so the take can be recorded in one go with any screen recorder.
//
//   1. npm run dev                      (the emulator window opens; put it in front, full size)
//   2. start your screen recorder on that window (Windows: Win+Alt+R)
//   3. node scripts/emu/video-take.mjs  (do not touch the mouse)
//
// It first sets the scene (a plan, one real hold, the Unsend window: about 40 seconds),
// prints TAKE STARTS, and then plays the shots of docs/SUBMISSION.md. Cut everything
// before TAKE STARTS when you edit.
//
// SLOW=1.3 stretches every pause (more room for the voice-over). AI=1 adds the spoken-limit
// shot with a canned answer (label it "simulated answer" in the video, or say the sentence
// yourself on a headset instead). What you see is the app as it is, with its own timings
// (a 1-second hold, a 5-second Unsend window); only the hand and the head are scripted.
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
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
let t0 = Date.now();
const say = (shot) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${shot}`);
/** Poll until `test()` is true (emulator commands are slow: never trust a fixed pause for state). */
async function until(test, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (test()) return true;
    await wait(0.3);
  }
  return false;
}

// ---------- the head (the camera) ----------
const SEAT = { x: 0, y: 1.2, z: 0 };
/** Where the wide shots are taken from, relative to the seat: a little behind, above and to the side. */
const WIDE = { x: 0.3, y: 0.28, z: 0.75 };
const angles = (from, to) => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  return { yaw: (Math.atan2(-d.x, -d.z) * 180) / Math.PI, pitch: (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI, roll: 0 };
};
/** Move the head smoothly to `pos`, looking at `target` (no jump cuts in the recording). */
function glide(pos, target, seconds = 1.1) {
  xr('animate-to', { device: 'headset', position: pos, orientation: angles(pos, target), duration: seconds });
}
const boardAt = () => {
  const b = hook('board').position;
  return { x: b[0], y: b[1], z: b[2] };
};
const deskAt = () => {
  const d = hook('desk')?.position ?? [0, 0.7, -0.6];
  return { x: d[0], y: d[1], z: d[2] };
};
/** Wide: the wall and the desk in one frame. `push` moves the camera that many metres toward the wall. */
function wide(seconds = 1.2, push = 0) {
  const b = boardAt();
  const d = deskAt();
  glide({ x: SEAT.x + WIDE.x, y: SEAT.y + WIDE.y, z: SEAT.z + WIDE.z - push }, { x: (b.x + d.x) / 2, y: b.y * 0.45 + d.y * 0.55, z: (b.z + d.z) / 2 }, seconds);
}
/** Close on one time of the week (day index, minute of the day). */
function closeOn(day, minute, dist = 0.6, seconds = 1.1) {
  const p = hook('muralPoint', day, minute);
  const b = boardAt();
  const at = p ? { x: p[0], y: p[1], z: p[2] } : b;
  glide({ x: at.x, y: at.y + 0.02, z: at.z + dist }, at, seconds);
}
/** The wall alone, from `dist` metres, aimed `dy` above the board's centre. */
function wall(dist, dy = 0, seconds = 1.1) {
  const b = boardAt();
  glide({ x: b.x, y: b.y + dy, z: b.z + dist }, { x: b.x, y: b.y + dy, z: b.z }, seconds);
}
/** Push in on the card on the desk. */
function card(seconds = 1.1) {
  const d = deskAt();
  glide({ x: d.x, y: d.y + 0.4, z: d.z + 0.28 }, d, seconds);
}

// ---------- the hand: it rests low and to the right of the seat, as a seated person's does ----------
const HAND = { x: SEAT.x + 0.2, y: SEAT.y - 0.24, z: SEAT.z - 0.32 };
function aim(name, seconds = 0.35) {
  const t = hook('targets')[name];
  const to = { x: t[0], y: t[1], z: t[2] };
  xr('animate-to', { device: 'hand-right', position: HAND, orientation: angles(HAND, to), duration: seconds });
  return to;
}
async function pinch(name) {
  aim(name);
  await beat(0.7);
  xr('select', { device: 'hand-right', duration: 0.25 });
}
const down = () => xr('set-select-value', { device: 'hand-right', value: 1 });
const up = () => xr('set-select-value', { device: 'hand-right', value: 0 });
const idle = () => until(() => !hook('interaction').busy && !hook('mural').sweeping, 30);

// ---------- set the scene (cut this part out of the video) ----------
cli(['browser', 'reload']);
await wait(3.5);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await wait(3.5);
try { xr('enter'); } catch {}
await wait(1.5);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
xr('set-transform', { device: 'headset', position: SEAT, orientation: { pitch: 0, yaw: 0, roll: 0 } });
xr('set-transform', { device: 'hand-right', position: HAND, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('simulateNoPlanes', false);
hook('setLateWallSeconds', 90);
hook('restart');
await wait(3);
hook('resetDemo');
await wait(0.5);
if (process.env.AI === '1') {
  hook('fakeAi', { intent: 'rule', rule: { after: '15:00', before: null, day: null, notDays: [] }, slotId: null, reason: '', body: '' });
}
console.log('\nSetting the scene: the agent plans a call, and one real hold approves it.');
await pinch('chip:task');
await idle();
aim('invite');
await wait(0.6);
down();
await until(() => hook('plan')?.approval === 'approved', 8);
up();
await until(() => hook('flow').sendingLeft === null && hook('outbox').length === 1, 40);
// The agent's next-step offer after an approval is answered "Later": the wall is calm for the first frame.
if (hook('flow').card) {
  await pinch('replan:no');
  await wait(1);
}
wide(1.2);
await wait(3);
const first = hook('outbox')[0];
if (!first || first.blocked || hook('plan')?.approval !== 'approved') {
  console.log('The scene is not set (no approved call on the wall). Stop and run it again.');
  process.exit(1);
}

console.log('\nTAKE STARTS\n');
t0 = Date.now();

say('1  wide: the week on the wall, Tuesday 1 PM approved (gold), the receipt on the desk; a slow push in');
wide(4, 0.35);
await beat(4);

say('2  pinch "Try a calendar change": a red block lands on Tuesday 1 PM; the old time is crossed out, CONFLICT');
await pinch('calendar');
closeOn(1, 13 * 60, 0.62, 1.2);
await beat(4);

say('3  wide: the card on the desk is BLOCKED; pinch "Wed 5:30 PM": a new card flies from Wednesday to the desk');
wide(1.2, 0.2);
await beat(1.6);
await pinch('cand0');
await beat(4.5);

say('4  push in on the card: WAS Tue 1:00 PM -> NOW Wed 5:30 PM, one trade-off');
card();
await beat(5);

say('5  wide: change your mind, pinch "Thu 1:00 PM": the preview jumps, a second card flies down');
wide(1.2, 0.2);
await beat(1.4);
await pinch('cand1');
await beat(4.5);

if (process.env.AI === '1') {
  say('5b a spoken limit: "Could we push it past three o\'clock?" (canned answer here)');
  await hook('heard', "Could we push it past three o'clock?");
  wall(0.62, 0.12);
  await beat(4.5);
  wide(1.2, 0.2);
  await pinch('cand1');
  await beat(3);
}

say('6  the card: start the hold and let go early: the ring drains, nothing is approved');
card();
await beat(1.5);
aim('invite');
await beat(0.8);
down();
await wait(0.35);
up();
await beat(3.5);

say('7  one full hold: the ring fills, the chime; approved');
down();
await until(() => hook('plan')?.approval === 'approved', 8);
up();
await beat(3);

say('8  the wall: the new time in gold; the outbox keeps the old one as REPLACED (the 5 s Unsend window runs first: cut it)');
await until(() => hook('flow').sendingLeft === null, 40);
wall(1.0, -0.08);
await beat(5);

say('9  the bar on top of the board: pinch it, pull the week toward you, push it back, let go near the wall: it snaps on');
{
  const b = boardAt();
  glide({ x: SEAT.x + 0.55, y: SEAT.y + 0.3, z: SEAT.z + 1.0 }, { x: b.x, y: b.y - 0.1, z: b.z }, 1.2);
  await beat(1.4);
  const bar = aim('grab:board');
  await beat(0.8);
  down();
  await wait(0.6);
  // Pull the hand back and swing it to the left: the board comes closer and follows the ray.
  const left = { x: bar.x - 0.55, y: bar.y - 0.05, z: bar.z };
  const back = { x: HAND.x, y: HAND.y, z: HAND.z + 0.1 };
  xr('animate-to', { device: 'hand-right', position: back, orientation: angles(back, left), duration: 1.6 });
  await beat(2.2);
  // Push it away again and swing back: it returns to the wall.
  const home = { x: bar.x + 0.1, y: bar.y, z: bar.z };
  const fwd = { x: HAND.x, y: HAND.y, z: HAND.z - 0.04 };
  xr('animate-to', { device: 'hand-right', position: fwd, orientation: angles(fwd, home), duration: 1.6 });
  await beat(2.2);
  up();
  await beat(2.5);
}

say('10 the start page: the new invite has "Open email draft" and "Add to my calendar"; the old one has neither');
try { xr('exit'); } catch {}
await wait(1.5);
evalPage(`(document.getElementById('intro').hidden = false, document.getElementById('sent-box').scrollIntoView({ block: 'center' }), 1)`);
await beat(6);

say('end the wall once more (hide the box), then your end card. Stop the recording.');
evalPage(`(document.getElementById('intro').hidden = true, 1)`);
await beat(5);
evalPage(`(document.getElementById('intro').hidden = false, 1)`);
if (process.env.AI === '1') hook('fakeAi', null);
