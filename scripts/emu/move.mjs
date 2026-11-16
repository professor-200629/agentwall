// Emulator checks for the third task: pinch one of your meetings, the agent offers to move it.
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/move.mjs   (sample week; every pinch is a real emulated pinch)
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
function evalPage(code) {
  process.env.AGENTWALL_PAGE = JSON.stringify({ do: 'eval', code });
  return cli(['browser', 'run', 'scripts/emu/page.mjs']).result;
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
function aimAt(t) {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
async function pinch() {
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(450);
}
const tap = async (name) => {
  aimAt(hook('targets')[name]);
  await pinch();
};
async function waitIdle(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(200);
  }
}
const TUE = '2026-11-17';
const cell = (day, start) => hook('weekCells').find((c) => c.day === day && c.start === start);

cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(localStorage.removeItem('agentwall.calendar.v1'), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
hook('resetDemo');
hook('setWatch', false);
hook('setLateWallSeconds', 90);
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 1);
try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('simulateNoPlanes', false);
hook('restart');
await sleep(2500);
xr('set-select-value', { device: 'hand-right', value: 0 });

// The week shows once the agent has planned something.
await tap('chip:task');
await waitIdle();
const days = [...new Set(hook('weekCells').map((c) => c.day))];
check('the week is up, with your Design review on Tuesday 2 PM', cell(TUE, 840)?.reason === 'You · Design review', JSON.stringify(cell(TUE, 840)));

// Hover, then pinch the meeting.
aimAt(hook('muralPoint', days.indexOf(TUE), 870));
await sleep(500);
check('pointing at your meeting says it can be moved', hook('mural').hover === 'Pinch to move: Design review', String(hook('mural').hover));
shot('move-hover');
await pinch();
let line = hook('interaction').agentLine;
check('a pinch still says why the agent cannot use that time, and offers to move it', /Design review/.test(line) && hook('flow').card === 'move', `${line} | card=${hook('flow').card}`);
const untouched = hook('plan');
check('offering changes nothing', !untouched.moving && /tester call/.test(untouched.task), untouched.task);
shot('move-offer');

await tap('replan:yes'); // Find a time
await waitIdle();
let plan = hook('plan');
// 1:30 PM and 2:30 PM are both 30 minutes away; the later one is taken (not 1:00 PM, the first of the day).
check('yes: the agent finds the nearest time the 90 minutes fit', plan.moving?.title === 'Design review' && plan.slot?.id === `${TUE}T14:30` && plan.approval === 'needs' && /nearest free 90 minutes: 30 min later, same day/.test(plan.reason), `${plan.task} -> ${plan.slot?.id} | ${plan.reason}`);
check('the card on the desk is a calendar change, not an email', /^Design review \(moved\): /.test(plan.invite.subject) && /^Your calendar/.test(plan.invite.to), `${plan.invite.to} | ${plan.invite.subject}`);
check('its old time no longer blocks it on the week', cell(TUE, 840)?.kind !== 'busy', JSON.stringify(cell(TUE, 840)));
shot('move-plan');

// A rule narrows the move; it does not start a different task.
await tap('chip:after4');
await waitIdle();
plan = hook('plan');
check('"Only after 4 PM" keeps it a move and finds a later time', plan.moving?.title === 'Design review' && plan.slot && plan.slot.start >= 960 && plan.constraint.after === 960, `${plan.slot?.id} ${JSON.stringify(plan.constraint)}`);
const target = plan.slot;

// Pinch and hold to approve.
aimAt(hook('targets').invite);
await sleep(300);
xr('set-select-value', { device: 'hand-right', value: 1 });
await sleep(1800);
xr('set-select-value', { device: 'hand-right', value: 0 });
await sleep(2600);
const box = hook('outbox');
line = hook('interaction').agentLine;
check('held: the change is in the demo outbox, with its length', box.length === 1 && box[0].status === 'sent' && box[0].minutes === 90, JSON.stringify(box.map((o) => [o.subject, o.status, o.minutes])));
check('no meeting follow-ups for a calendar change', hook('flow').card === null, `card=${hook('flow').card} | ${line}`);
check('the meeting now sits at its new time', cell(target.day, target.start)?.reason === 'You · Design review' && cell(TUE, 840)?.kind !== 'busy', `${JSON.stringify(cell(target.day, target.start))} | old ${JSON.stringify(cell(TUE, 840))}`);
shot('move-done');

// The next task plans around the moved meeting.
await hook('heard', 'any time');
await waitIdle();
await tap('chip:task');
await waitIdle();
plan = hook('plan');
const clash = plan.slot.day === target.day && plan.slot.start < target.end + 10 && plan.slot.end > target.start - 10;
check('the next call is planned around the moved meeting', !plan.moving && /tester call/.test(plan.task) && !clash, `${plan.task} -> ${plan.slot.id}`);

// Back on the page: a calendar file, and nobody to email.
try { xr('exit'); } catch (e) { console.log('      exit:', e.message.slice(0, 120)); }
await sleep(1500);
const sent = evalPage(`(() => { const b = document.getElementById('sent-box'); return { hidden: b.hidden, text: b.textContent, links: [...b.querySelectorAll('a')].map((a) => a.textContent) }; })()`);
check('"Approved by you" offers the change as a calendar file only', sent.hidden === false && /Design review \(moved\)/.test(sent.text) && sent.links.length === 1 && /calendar/.test(sent.links[0]), JSON.stringify(sent.links));

hook('resetDemo');
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
