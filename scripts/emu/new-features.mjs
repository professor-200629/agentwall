// Emulator checks for the 16 Nov features: morning queue, a rule offered from your
// corrections, field-of-view fit + desk hint, and look + pinch (eye gaze).
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/new-features.mjs
// Pinches are real emulated pinches; the gaze part uses the emulator's gaze source.
import { execFileSync } from 'node:child_process';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const out = execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(json.error?.message ?? json)}`);
  return json.data;
}
const xr = (action, input = {}) => cli(['xr', action], input);
function hook(fn, ...args) {
  process.env.AGENTWALL_CALL = JSON.stringify({ fn, args });
  return cli(['browser', 'run', 'scripts/emu/call.mjs']).result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const shot = (name) => {
  try {
    console.log(`      shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
  } catch (e) {
    console.log(`      shot ${name} failed: ${e.message.slice(0, 100)}`);
  }
};
const HEAD = { x: 0, y: 1.2, z: 0 };
const look = (yaw, pitch = 0, position = HEAD) =>
  xr('set-transform', { device: 'headset', position, orientation: { pitch, yaw, roll: 0 } });
function aimAt(t) {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
const aim = (name) => aimAt(hook('targets')[name]);
const pinchValue = (value) => xr('set-select-value', { device: 'hand-right', value });
async function pinch() {
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(450);
}
async function tap(name) {
  aim(name);
  await pinch();
}
async function waitIdle(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(200);
  }
}
async function holdInvite() {
  aim('invite');
  await sleep(300);
  pinchValue(1);
  await sleep(1800);
  pinchValue(0);
  await sleep(300);
}
async function waitSent(ms = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (hook('flow').sendingLeft === null && hook('plan')?.approval === 'approved') return true;
    await sleep(250);
  }
  return false;
}

// ---------- start ----------
cli(['browser', 'reload']);
await sleep(3000);
hook('resetDemo');
hook('setWatch', false);
hook('setLateWallSeconds', 90);
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 1);
try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
try { xr('set-connected', { device: 'gaze', connected: false }); } catch { console.log('      (this emulated device has no gaze source)'); }
look(0);
hook('simulateNoPlanes', false);
hook('restart');
await sleep(2000);
pinchValue(0);
check('board placed', hook('board').visible, hook('state'));

// ---------- 1. Morning queue ----------
check('the queue card is offered', hook('offerQueue') === true && hook('flow').card === 'queue', JSON.stringify(hook('queue')));
shot('queue-card');
await tap('replan:yes'); // Start
await waitIdle();
let plan = hook('plan');
check('Start runs the first item: focus time', /focus/i.test(plan?.task ?? '') && hook('queue').running === true, plan?.task);
await holdInvite();
let sent = await waitSent();
await sleep(400);
let q = hook('queue');
check('holding it clears item 1 and the agent offers the next', sent && q.done.includes('focus') && hook('flow').card === 'queue', `${q.line} | card=${hook('flow').card}`);
shot('queue-next');
await tap('replan:yes'); // Next
await waitIdle();
plan = hook('plan');
check('Next runs the second item: the tester call', /tester call/i.test(plan?.task ?? ''), plan?.task);
await holdInvite();
sent = await waitSent();
await sleep(400);
check('after the call goes out the agent offers its follow-ups first', sent && hook('flow').card === 'prep', `card=${hook('flow').card}`);
await tap('replan:no');
await sleep(300);
await tap('replan:no');
await sleep(300);
q = hook('queue');
const line = hook('interaction').agentLine;
check('all clear: the day is counted once', q.done.length === 2 && q.streak === 1 && /All clear for today · 1 day in a row/.test(line) && hook('flow').card === null, `${q.line} | ${line}`);
check('nothing is offered again today', hook('offerQueue') === false, hook('queue').line);
shot('queue-all-clear');

// ---------- 2. A rule offered from two corrections ----------
hook('resetDemo');
await tap('chip:task');
await waitIdle();
plan = hook('plan');
const first = plan.slot;
const days = [...new Set(hook('weekCells').map((c) => c.day))];
const freeElsewhere = () =>
  hook('weekCells').filter((c) => c.kind === 'free' && c.day !== first.day && c.start % 30 === 0);
async function pickCell(cell) {
  aimAt(hook('muralPoint', days.indexOf(cell.day), cell.start));
  await pinch();
}
let cells = freeElsewhere();
console.log(`      agent picked ${first.id}; free elsewhere: ${cells.length}`);
await pickCell(cells[0]);
let learned = hook('learned');
check('first correction is remembered, nothing is offered yet', hook('plan').slot.id !== first.id && learned.corrections.length === 1 && learned.offer === null && hook('flow').card === null, JSON.stringify(learned));
await tap('chip:task'); // the agent plans again and picks its own time again
await waitIdle();
check('the agent picks its own time again', hook('plan').slot.id === first.id && hook('plan').by !== 'you', `${hook('plan').slot.id} by ${hook('plan').by}`);
cells = freeElsewhere();
await pickCell(cells[cells.length - 1]);
learned = hook('learned');
check('second correction that agrees: the agent offers a rule', learned.offer === `not:${first.day}` && hook('flow').card === 'rule', JSON.stringify(learned));
const before = hook('plan');
check('offering changes nothing by itself', !before.constraint.notDays, JSON.stringify(before.constraint));
shot('rule-offer');
await tap('replan:yes'); // Add rule
await waitIdle();
plan = hook('plan');
check('yes adds the rule and the agent re-plans inside it', plan.constraint.notDays?.includes(first.day) && plan.slot && plan.slot.day !== first.day && /Rule added/.test(hook('interaction').agentLine), `${JSON.stringify(plan.constraint)} -> ${plan.slot?.id} | ${hook('interaction').agentLine}`);
check('the pattern starts counting again', hook('learned').corrections.length === 0 && hook('flow').card === null, JSON.stringify(hook('learned')));
shot('rule-added');

// ---------- 3. Field of view ----------
hook('resetDemo');
let v = hook('view');
const place = hook('placement');
console.log(`      device view ${JSON.stringify(v.fovDeg)}, board ${place.distance.toFixed(2)} m away, scale ${v.scale.toFixed(2)} (asked ${v.asked})`);
check('the device\'s own view angles are read', Array.isArray(v.fovDeg) && v.fovDeg[0] > 30 && v.fovDeg[1] > 30, JSON.stringify(v.fovDeg));
const fit = (dist, h, vv, asked) => {
  const r = (d) => (d * Math.PI) / 180;
  const f = Math.min((2 * dist * Math.tan((r(h) * 0.8) / 2)) / 1.2, (2 * dist * Math.tan((r(vv) * 0.8) / 2)) / 0.94);
  return Math.max(0.45, Math.min(asked, f));
};
// Step close to the wall, as someone seated at a desk against it would be.
const b0 = hook('board').position;
const dir = { x: b0[0] - HEAD.x, z: b0[2] - HEAD.z };
const len = Math.hypot(dir.x, dir.z);
const near = { x: HEAD.x + (dir.x / len) * (len - 0.7), y: 1.2, z: HEAD.z + (dir.z / len) * (len - 0.7) };
look(0, 0, near);
await sleep(600);
hook('setFov', 110, 96);
await sleep(300);
const wide = hook('view').scale;
shot('fov-quest-near');
hook('setFov', 70, 66);
await sleep(300);
const narrow = hook('view').scale;
shot('fov-glasses-near');
const distNear = Math.hypot(b0[0] - near.x, b0[1] - near.y, b0[2] - near.z);
check('0.7 m from the wall with the glasses\' view: the board shrinks to fit', narrow < wide && Math.abs(narrow - fit(distNear, 70, 66, place.scale)) < 0.03, `quest ${wide.toFixed(2)} glasses ${narrow.toFixed(2)} expected ${fit(distNear, 70, 66, place.scale).toFixed(2)}`);
hook('setFov', null);
look(0);
// The fit happens when the board is placed (it must not resize as you lean): place it again.
hook('restart');
await sleep(2500);
v = hook('view');
check('back at the seat with the real view: full size again', Math.abs(v.scale - fit(place.distance, v.fovDeg[0], v.fovDeg[1], place.scale)) < 0.03, `scale ${v.scale.toFixed(2)}`);

// Desk hint: the card is out of view while you look at the wall.
await tap('chip:task');
await waitIdle();
await sleep(400);
check('looking at the wall: the tab under the board points to the desk card', hook('view').deskHint === true, JSON.stringify(hook('view')));
shot('desk-hint');
const d = hook('desk').position;
xr('look-at', { device: 'headset', target: { x: d[0], y: d[1], z: d[2] } });
await sleep(500);
check('looking at the desk card: the tab goes away', hook('view').deskHint === false, JSON.stringify(hook('view')));
look(0);
await sleep(300);

// ---------- 4. Look + pinch (eye gaze) ----------
hook('resetDemo');
await sleep(300);
let gazeOk = true;
try {
  xr('set-connected', { device: 'gaze', connected: true });
} catch (e) {
  gazeOk = false;
  console.log('      SKIPPED look + pinch: this emulated device has no gaze source (use device metaVRGlasses)');
}
if (gazeOk) {
  // The hand rests low and points at the floor: it cannot be what selects the chip.
  xr('set-transform', { device: 'hand-right', position: { x: 0.2, y: 0.75, z: -0.25 }, orientation: { pitch: -80, yaw: 0, roll: 0 } });
  const chip = hook('targets')['chip:task'];
  xr('look-at', { device: 'gaze', target: { x: chip[0], y: chip[1], z: chip[2] } });
  await sleep(800);
  const i = hook('interaction');
  check('eye gaze is active and the hints say "look"', hook('view').gaze === true, JSON.stringify(hook('view')));
  check('looking at the chip hovers it', i.chipHovered === 0, `chipHovered=${i.chipHovered}`);
  shot('gaze-hover');
  const pressesBefore = i.presses;
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(600);
  await waitIdle();
  check('a pinch with the hand in the lap selects what you look at', hook('interaction').presses > pressesBefore && hook('plan') !== null, `presses ${pressesBefore} -> ${hook('interaction').presses}, plan ${hook('plan')?.slot?.id}`);
  // Hold-approve by gaze: look at the invite on the desk, pinch and hold.
  const inv = hook('targets').invite;
  xr('look-at', { device: 'headset', target: { x: inv[0], y: inv[1], z: inv[2] } });
  xr('look-at', { device: 'gaze', target: { x: inv[0], y: inv[1], z: inv[2] } });
  await sleep(600);
  pinchValue(1);
  await sleep(1800);
  pinchValue(0);
  await sleep(300);
  check('look at the card + pinch and hold approves it', hook('plan')?.approval === 'approved', `approval=${hook('plan')?.approval} peak=${hook('interaction').peakHold}`);
  xr('set-connected', { device: 'gaze', connected: false });
  await sleep(500);
  look(0);
  check('without a gaze source the hand ray points again', hook('view').gaze === false, JSON.stringify(hook('view')));
  hook('resetDemo');
  await tap('chip:task');
  await waitIdle();
  check('hand-ray pinch still works afterwards', hook('plan') !== null, hook('plan')?.slot?.id);
}

hook('resetDemo');
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
