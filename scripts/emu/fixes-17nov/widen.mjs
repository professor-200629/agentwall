// A day limit whose day fills up: the review must offer other days and say which limit it dropped.
// Run from the agentwall folder, dev server up:  node scripts/emu/fixes-17nov/<this file>
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
const home = () => xr('set-transform', { device: 'headset', position: HOME, orientation: { pitch: 0, yaw: 0, roll: 0 } });
function wallView(dist = 0.62, dy = 0.14) {
  const b = hook('board').position;
  xr('set-transform', { device: 'headset', position: { x: b[0], y: b[1] + dy, z: b[2] + dist }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: b[0], y: b[1] + dy, z: b[2] } });
}
async function shot(name) {
  await sleep(700);
  console.log(`shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
}
function aim(name) {
  const t = hook('targets')[name];
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
async function tap(name) {
  aim(name);
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(700);
}
async function hold(seconds = 2.6) {
  aim('invite');
  await sleep(300);
  xr('set-select-value', { device: 'hand-right', value: 1 });
  await sleep(seconds * 1000);
  xr('set-select-value', { device: 'hand-right', value: 0 });
  await sleep(600);
}
async function idle(ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(300);
  }
}
async function unsendOver(ms = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (hook('flow').sendingLeft === null) return;
    await sleep(500);
  }
}

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
hook('resetDemo');
await sleep(500);

// ---------- 1. An approved call with the limit "only on Tuesday"; Tuesday then fills up ----------
await hook('heard', 'on Tuesday');
await idle();
let plan = hook('plan');
check('"on Tuesday": the draft is Tue 1:00 PM with that limit', plan?.slot?.id === '2026-11-17T13:00' && /Tue/.test(plan.constraintText), `${plan?.slot?.id} | ${plan?.constraintText}`);
await hold();
await unsendOver();
let box = hook('outbox');
check('approved by a hold and sent', box.length === 1 && box[0].status !== 'sending' && !box[0].blocked, JSON.stringify(box.map((o) => [o.slotId, o.status])));
await hook('calendarChange'); // the same as pinching "Try a calendar change"
await sleep(1500);
let rv = hook('review');
box = hook('outbox');
check('the example change blocks the Tuesday call', box[0].blocked?.why === 'conflict' && rv?.old === '2026-11-17T13:00', JSON.stringify(box[0].blocked));
check('Tuesday is full, so the review offers two times on other days', rv?.candidates.length === 2 && rv.candidates.every((c) => !c.id.startsWith('2026-11-17')), JSON.stringify(rv?.candidates.map((c) => c.label)));
check('both big time buttons are shown', rv?.bar === true);
wallView();
await shot('1-widened-bar');
home();
await tap('cand0');
await sleep(1500);
plan = hook('plan');
rv = hook('review');
check('pinching the first time puts it on trial', rv?.trial === 0 && plan?.slot?.id === rv.candidates[0].id && plan.approval === 'needs', `${plan?.slot?.id} ${plan?.approval}`);
check('the trial card does not carry the old limit', plan?.constraintText === '', `"${plan?.constraintText}"`);
check('the week does not rule the trial time out', hook('weekCells').some((c) => c.day === plan.slot.day && c.start === plan.slot.start && c.kind !== 'rule'), '');
await hold();
await unsendOver();
box = hook('outbox');
const old = box.find((o) => o.slotId === '2026-11-17T13:00');
const fresh = box.find((o) => o.slotId === plan.slot.id);
check('a hold approves the replacement; the old call is REPLACED by it', !!fresh && !fresh.blocked && old?.blocked?.why === 'superseded' && old.blocked.by === fresh.id, JSON.stringify(box.map((o) => [o.slotId, o.blocked?.why ?? 'ok'])));
check('the review is over', hook('review') === null);

// ---------- 2. The same for a draft, and after a reload ----------
hook('resetDemo');
await sleep(500);
await hook('heard', 'on Tuesday');
await idle();
check('a new draft on Tuesday', hook('plan')?.slot?.id === '2026-11-17T13:00' && hook('plan')?.approval === 'needs');
hook('changeUnderHand');
await sleep(1500);
rv = hook('review');
check('a draft whose only day fills up: two times on other days are offered', rv?.item === null && rv.candidates.length === 2 && rv.candidates.every((c) => !c.id.startsWith('2026-11-17')), JSON.stringify(rv?.candidates.map((c) => c.label)));
await hold();
check('a hold on the blocked draft approves nothing', hook('outbox').length === 0 && hook('plan')?.approval === 'needs');

// A limit said during the review is kept as said.
await hook('heard', 'on Tuesday');
await idle();
rv = hook('review');
check('saying "on Tuesday" in the review: no time fits that, and it is not widened behind your back', rv?.candidates.length === 0 && /Tue/.test(rv.heard?.text ?? ''), JSON.stringify(rv?.heard));
await hook('heard', 'any time');
await idle();
rv = hook('review');
check('saying "any time" brings the times back', rv?.candidates.length === 2, JSON.stringify(rv?.candidates.map((c) => c.label)));

const errs = evalPage('window.__errs || []');
check('no JavaScript errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
home();
