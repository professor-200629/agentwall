// The agent's card stops the ray; Unsend still works a moment after an approval.
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
const HAND = { x: 0.18, y: 1.0, z: -0.3 };
const home = () => xr('set-transform', { device: 'headset', position: HOME, orientation: { pitch: 0, yaw: 0, roll: 0 } });
function aimAt(p) {
  xr('set-transform', { device: 'hand-right', position: HAND, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: p[0], y: p[1], z: p[2] } });
}
async function tapAt(p) {
  aimAt(p);
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(700);
}
const tap = (name) => tapAt(hook('targets')[name]);
async function hold(seconds = 2.6) {
  aimAt(hook('targets').invite);
  await sleep(300);
  xr('set-select-value', { device: 'hand-right', value: 1 });
  await sleep(seconds * 1000);
  xr('set-select-value', { device: 'hand-right', value: 0 });
  await sleep(600);
}
async function until(test, ms = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (test()) return true;
    await sleep(400);
  }
  return false;
}
const idle = () => until(() => !hook('interaction').busy && !hook('mural').sweeping, 30_000);
async function shot(name) {
  await sleep(700);
  console.log(`shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
}

cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
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

await tap('chip:task');
await idle();
await hold();
await until(() => hook('flow').sendingLeft === null, 60_000);
await until(() => hook('flow').card !== null, 10_000);
const kind = hook('flow').card;
console.log(`      agent card: ${kind} | desk: ${hook('desk')?.kind}`);
check('an agent card follows the approval', kind !== null);
if (kind) {
  const s = hook('flow').boardScale;
  const yes = hook('targets')['replan:yes'];
  const before = hook('plan');
  const line = hook('interaction').agentLine;
  const presses = hook('interaction').presses;
  // The card's body: its text, well left of the two buttons (the buttons sit on its right half).
  const body = [
    [yes[0] - 0.3 * s, yes[1], yes[2]],
    [yes[0] - 0.45 * s, yes[1] + 0.02 * s, yes[2]],
    [yes[0] - 0.38 * s, yes[1] - 0.025 * s, yes[2]],
  ];
  for (const p of body) await tapAt(p);
  const after = hook('plan');
  const it = hook('interaction');
  // An offer nobody answers gives way to the next one after 25 s ("No answer · the agent skipped
  // that suggestion"), so on a slow emulator the card may have moved on by itself. What counts: no
  // press was counted (a pinch that reached the week or a pill behind the card is one), and the plan
  // is as it was.
  const quiet = it.agentLine === line || /^No answer/.test(it.agentLine);
  check(
    'three pinches on the card\'s text reach nothing behind it: no press was counted, and the plan is as it was',
    after?.slot?.id === before?.slot?.id && after?.approval === before?.approval && after?.version === before?.version && hook('flow').card !== null && quiet && it.presses === presses,
    `${before?.slot?.id}/${before?.approval}/v${before?.version} -> ${after?.slot?.id}/${after?.approval}/v${after?.version} card=${hook('flow').card} presses +${it.presses - presses} | ${it.agentLine}`,
  );
  aimAt(body[0]);
  await shot('agent-card');
  const shown = hook('flow').card;
  await tap('replan:no');
  await sleep(900);
  check('the card\'s own button still works', hook('flow').card !== shown, `${shown} -> ${hook('flow').card}`);
}

// Unsend a moment after an approval (a long window: emulator commands are slow).
hook('resetDemo');
await sleep(500);
hook('setUnsendSeconds', 60);
await tap('chip:task');
await idle();
await hold();
await sleep(1500);
check('approved, inside its Unsend window', hook('flow').sendingLeft !== null && hook('outbox').length === 1);
await tap('invite');
await sleep(700);
check('a pinch on the card a moment later is Unsend', hook('outbox').length === 0 && hook('plan')?.approval === 'needs', hook('interaction').agentLine);
hook('setUnsendSeconds', 5);
console.log(`\n${pass} passed, ${fail} failed`);
