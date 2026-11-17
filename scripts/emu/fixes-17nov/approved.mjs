// What you approved is busy time: the agent does not offer it again, the week shows it,
// and the hold refuses a time another approval holds. Plus the start-page fixes.
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
function wallView(dist = 0.75, dy = 0.0) {
  const b = hook('board').position;
  xr('set-transform', { device: 'headset', position: { x: b[0], y: b[1] + dy, z: b[2] + dist }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: b[0], y: b[1] + dy, z: b[2] } });
}
async function shot(name) {
  await sleep(700);
  console.log(`shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
}
function aimAt(p) {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: p[0], y: p[1], z: p[2] } });
}
const aim = (name) => aimAt(hook('targets')[name]);
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
const overlap = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;
const slotOf = (item) => {
  const start = Number(item.slotId.slice(11, 13)) * 60 + Number(item.slotId.slice(14, 16));
  return { day: item.slotId.slice(0, 10), start, end: start + (item.minutes ?? 30) };
};

async function fresh() {
  cli(['browser', 'reload']);
  await sleep(3500);
  evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
  cli(['browser', 'reload']);
  await sleep(3500);
}

// ---------- 0. The start page, before mixed reality ----------
await fresh();
const page = evalPage(`(() => { const d = document.getElementById('cal-setup'); d.open = true; const cs = (id) => getComputedStyle(document.getElementById(id)).display; const e = document.getElementById('enter-xr'); return { save: cs('cal-save'), sample: cs('cal-sample'), read: cs('cal-read'), enter: e.textContent, enterDisabled: e.disabled, summary: document.querySelector('#how summary').textContent, steps: document.querySelectorAll('#how li').length, hint: !!document.getElementById('sent-hint'), intro: document.querySelector('#intro p').textContent.slice(0, 60) }; })()`);
check('on the sample week "Save these" and "Back to the sample week" are not shown', page.save === 'none' && page.sample === 'none' && page.read !== 'none', JSON.stringify(page));
check('once loaded the button says "Enter mixed reality"', page.enter === 'Enter mixed reality', `${page.enter} disabled=${page.enterDisabled}`);
check('the list is headed "What to do", whatever its length', page.summary === 'What to do' && page.steps === 5, `${page.summary} (${page.steps})`);
evalPage(`(document.getElementById('cal-setup').open = false, window.__errs = [], addEventListener('error', (e) => window.__errs.push(e.message)), addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason && e.reason.message || e.reason))), 1)`);

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

// ---------- 1. Asking for the same call twice ----------
await tap('chip:task');
await idle();
let plan = hook('plan');
check('first ask: Tue 1:00 PM', plan?.slot?.id === '2026-11-17T13:00', plan?.slot?.id);
await hold();
await unsendOver();
let box = hook('outbox');
check('approved and sent', box.length === 1 && box[0].status === 'sent');
if (hook('flow').card) {
  await tap('replan:no');
  await sleep(800);
}
if (hook('flow').card) {
  await tap('replan:no');
  await sleep(800);
}
await tap('chip:task');
await idle();
plan = hook('plan');
const first = slotOf(box[0]);
check('second ask: a different time, never the approved one', !!plan?.slot && plan.approval === 'needs' && !overlap(plan.slot, first), `${plan?.slot?.id} ${plan?.approval}`);
check('nor as a runner-up', (plan?.alternatives ?? []).every((s) => !overlap(s, first)), JSON.stringify((plan?.alternatives ?? []).map((s) => s.id)));
const cells = hook('weekCells');
const cell = cells.find((c) => c.day === '2026-11-17' && c.start === 13 * 60);
check('the week shows the approved call as busy time', cell?.kind === 'busy' && /approved/i.test(cell.reason), JSON.stringify(cell));
wallView();
await shot('1-second-ask');
home();

// ---------- 2. Picking the approved time by hand: the hold refuses it ----------
const p = hook('muralPoint', 1, 13 * 60 + 10);
aimAt(p);
await sleep(300);
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(1200);
plan = hook('plan');
console.log(`      after pinching Tue 1:00 PM on the week: ${plan?.slot?.id} ${plan?.approval} | ${hook('interaction').agentLine}`);
if (plan?.slot?.id === '2026-11-17T13:00') {
  await hold();
  await sleep(500);
  box = hook('outbox');
  check('a hold on a time another approval holds approves nothing, and says why', box.length === 1 && hook('plan')?.approval === 'needs' && /already approved Tue 1:00 PM/.test(hook('interaction').agentLine), hook('interaction').agentLine);
} else {
  check('the approved time cannot be picked on the week (it is busy)', plan?.slot?.id !== '2026-11-17T13:00', plan?.slot?.id);
}

// ---------- 3. A call does not land on an approved focus block ----------
hook('resetDemo');
await sleep(500);
await tap('chip:focus');
await idle();
plan = hook('plan');
check('focus time: Thu 12:30 – 2:30 PM', plan?.slot?.id === '2026-11-19T12:30' && plan.slot.end - plan.slot.start === 120, plan?.slot?.id);
await hold();
await unsendOver();
box = hook('outbox');
check('the focus block is approved', box.length === 1 && box[0].status === 'sent', JSON.stringify(box.map((o) => [o.slotId, o.status])));
for (let i = 0; i < 2 && hook('flow').card; i++) {
  await tap('replan:no');
  await sleep(800);
}
await tap('chip:task');
await idle();
await tap('chip:thu');
await idle();
plan = hook('plan');
const focus = slotOf({ slotId: '2026-11-19T12:30', minutes: 120 });
check('"Thursday" for the call: not on top of the focus block', plan?.slot?.day === '2026-11-19' && !overlap(plan.slot, focus), `${plan?.slot?.id}`);
await hold();
await unsendOver();
box = hook('outbox');
check('both are approved, at different times', box.length === 2 && box.every((o) => !o.blocked) && !overlap(slotOf(box[0]), slotOf(box[1])), JSON.stringify(box.map((o) => o.slotId)));

// ---------- 4. An approval made just before the page closes ----------
hook('resetDemo');
await sleep(500);
hook('setUnsendSeconds', 60);
await tap('chip:task');
await idle();
await hold();
await sleep(500);
check('inside the Unsend window', hook('flow').sendingLeft !== null && hook('outbox')[0]?.status === 'sending');
cli(['browser', 'reload']);
await sleep(4500);
const saved = JSON.parse(evalPage(`localStorage.getItem('agentwall.board.v1')`) ?? 'null');
check('after a reload the saved board says "sent", so the start page lists it', saved?.outbox?.[0]?.status === 'sent', JSON.stringify(saved?.outbox?.map((o) => o.status)));
const listed = evalPage(`document.querySelectorAll('#sent-list li').length`);
check('"Approved by you" shows it', listed === 1, String(listed));

const errs = evalPage('window.__errs || []');
check('no JavaScript errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
