// The third review's fixes, in the emulator. Run from the agentwall folder:  node <this file>
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}
const HOME = { x: 0, y: 1.2, z: 0 };
const HAND = { x: 0.18, y: 1.0, z: -0.3 };
const home = () => xr('set-transform', { device: 'headset', position: HOME, orientation: { pitch: 0, yaw: 0, roll: 0 } });
function wallView(dist = 0.75, dy = 0.0) {
  const b = hook('board').position;
  xr('set-transform', { device: 'headset', position: { x: b[0], y: b[1] + dy, z: b[2] + dist }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: b[0], y: b[1] + dy, z: b[2] } });
}
async function shot(name) {
  await sleep(700);
  console.log(`shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
}
function aimAt(p, from = HAND) {
  xr('set-transform', { device: 'hand-right', position: from, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: p[0], y: p[1], z: p[2] } });
}
const aim = (name) => aimAt(hook('targets')[name]);
async function tapAt(p) {
  aimAt(p);
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(700);
}
const tap = (name) => tapAt(hook('targets')[name]);
const down = () => xr('set-select-value', { device: 'hand-right', value: 1 });
const up = () => xr('set-select-value', { device: 'hand-right', value: 0 });
async function hold(seconds = 2.6) {
  aim('invite');
  await sleep(300);
  down();
  await sleep(seconds * 1000);
  up();
  await sleep(600);
}
async function idle(ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(300);
  }
}
async function until(test, ms = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (test()) return true;
    await sleep(400);
  }
  return false;
}
const unsendOver = () => until(() => hook('flow').sendingLeft === null, 60_000);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(window.__errs = [], addEventListener('error', (e) => window.__errs.push(e.message)), addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason && e.reason.message || e.reason))), 1)`);
try { xr('enter'); } catch {}
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
home();
hook('simulateNoPlanes', false);
hook('setLateWallSeconds', 90);
hook('restart');
await sleep(2500);

// ---------- 1. "Try it", then "Not now": the blocked time is not the agent's pick ----------
await tap('replan:yes');
await sleep(1500);
check('"Try it" opens the review', hook('review') !== null);
await tap('review:cancel');
await sleep(1200);
check('"Not now": the review is put off and the card stays blocked', hook('review') === null && hook('flow').conflict !== null, hook('interaction').agentLine);
check('no "also free" pills while the card is blocked', hook('mural').pills === 0, String(hook('mural').pills));
wallView();
await shot('1-not-now-wall');
home();

// ---------- 2. Plan again while the old one is blocked; "Review conflict" inside the Unsend window ----------
hook('setUnsendSeconds', 30);
await tap('chip:task');
await idle();
let plan = hook('plan');
check('planning again gives a new draft at a free time', plan?.approval === 'needs' && plan.slot?.id !== '2026-11-17T13:00', plan?.slot?.id);
await hold();
await sleep(400);
check('approved, inside its Unsend window', hook('flow').sendingLeft !== null && hook('outbox').some((o) => o.status === 'sending'));
const ctl = hook('calendarControl');
console.log(`      control now: ${ctl?.label}`);
await tap('calendar');
await sleep(800);
check('the control does not open a review over a card that is still sending', hook('review') === null && /Still sending/.test(hook('interaction').agentLine), hook('interaction').agentLine);
hook('setUnsendSeconds', 5);
await until(() => hook('flow').sendingLeft === null, 60_000);
let box = hook('outbox');
const fresh = box.find((o) => o.slotId === plan.slot.id);
const old = box.find((o) => o.slotId === '2026-11-17T13:00');
check('when the window ends the new call is sent and the old one is REPLACED by it', fresh?.status === 'sent' && !fresh.blocked && old?.blocked?.why === 'superseded' && old.blocked.by === fresh.id, JSON.stringify(box.map((o) => [o.slotId, o.status, o.blocked?.why ?? 'ok'])));

// (The agent's card stopping the ray, and Unsend a moment after an approval: see card.mjs.)

// ---------- 4. A pinch on the card's bar from a hand close to it: no hop ----------
const bar = hook('targets')['grab:card'];
const deskBefore = hook('desk').position;
const near = { x: bar[0] + 0.05, y: bar[1] + 0.12, z: bar[2] + 0.15 }; // about 20 cm from the bar
aimAt(bar, near);
await sleep(300);
down();
await sleep(1500);
const during = hook('drag');
up();
await sleep(800);
const deskAfter = hook('desk').position;
check('a still pinch on the card\'s bar from 20 cm away moves nothing', dist(deskBefore, deskAfter) < 0.01 && !hook('drag').cardPlacedByYou, `moved ${(dist(deskBefore, deskAfter) * 100).toFixed(1)} cm, dragging=${during.active}, placed=${hook('drag').cardPlacedByYou}`);
// And a real drag from there still works.
aimAt(bar, near);
await sleep(300);
down();
await sleep(500);
xr('look-at', { device: 'hand-right', target: { x: bar[0] + 0.2, y: bar[1], z: bar[2] - 0.1 } });
await sleep(900);
up();
await sleep(800);
check('a real drag from there moves the card', dist(deskBefore, hook('desk').position) > 0.05 && hook('drag').cardPlacedByYou, `moved ${(dist(deskBefore, hook('desk').position) * 100).toFixed(1)} cm`);

// ---------- 5. A hand that travels while it pinches the card does not approve ----------
hook('resetDemo');
await sleep(500);
await tap('chip:task');
await idle();
hook('setHoldSeconds', 30); // emulator commands take seconds: room to move the hand before the ring is full
aim('invite');
await sleep(300);
down();
await sleep(700);
const mid = hook('interaction').hold;
xr('set-transform', { device: 'hand-right', position: { x: HAND.x + 0.14, y: HAND.y, z: HAND.z } });
await sleep(2500);
const afterMove = hook('interaction');
up();
await sleep(600);
check('the hold was filling, the hand moved 14 cm: the hold is cancelled and nothing is approved', mid > 0 && mid < 1 && hook('outbox').length === 0 && hook('plan')?.approval === 'needs' && /your hand moved/.test(afterMove.agentLine), `mid=${mid.toFixed(2)} | ${afterMove.agentLine}`);
hook('setHoldSeconds', 1);
await hold();
await sleep(500);
check('a still hold approves as before', hook('outbox').length === 1 && hook('plan')?.approval === 'approved');

// ---------- 6. The example, again and again ----------
hook('resetDemo');
await sleep(500);
await tap('chip:task');
await idle();
await hold();
await unsendOver();
let rounds = 0;
let least = 99;
for (let round = 1; round <= 7; round++) {
  await hook('calendarChange');
  await sleep(1200);
  const rv = hook('review');
  if (!rv) {
    console.log(`      round ${round}: no review | ${hook('interaction').agentLine}`);
    break;
  }
  least = Math.min(least, rv.candidates.length);
  if (rv.candidates.length === 0) {
    console.log(`      round ${round}: no other time | ${hook('interaction').agentLine}`);
    break;
  }
  await tap('cand0');
  await sleep(1200);
  await hold();
  await unsendOver();
  if (hook('review') !== null) {
    console.log(`      round ${round}: the review did not close | ${hook('interaction').agentLine}`);
    break;
  }
  rounds = round;
}
box = hook('outbox');
check('seven example changes in a row, each replaced: there is always another time', rounds === 7 && least >= 1, `rounds=${rounds} least candidates=${least} outbox=${JSON.stringify(box.map((o) => [o.slotId, o.blocked?.why ?? 'ok']))}`);
check('one approval stands at the end, the rest are history', box.filter((o) => !o.blocked).length === 1 && new Set(box.map((o) => o.id)).size === box.length, JSON.stringify(box.map((o) => o.id)));
check('the week keeps three example blocks', hook('calendar').busy === 11 + 3, String(hook('calendar').busy));

const errs = evalPage('window.__errs || []');
check('no JavaScript errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
home();
