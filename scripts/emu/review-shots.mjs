// Close-up screenshots of the conflict review, for looking at (not checks).
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/review-shots.mjs
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
const HOME = { x: 0, y: 1.2, z: 0 };
/** Look at the wall board from `dist` metres in front of it. */
function wallView(dist = 0.95, dy = 0) {
  const b = hook('board').position;
  xr('set-transform', { device: 'headset', position: { x: b[0], y: b[1] + dy, z: b[2] + dist }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: b[0], y: b[1] + dy, z: b[2] } });
}
/** Look down at the desk card from above and behind it. */
function deskView() {
  const d = hook('desk').position;
  xr('set-transform', { device: 'headset', position: { x: d[0], y: d[1] + 0.42, z: d[2] + 0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: d[0], y: d[1], z: d[2] } });
}
const home = () => xr('set-transform', { device: 'headset', position: HOME, orientation: { pitch: 0, yaw: 0, roll: 0 } });
async function shot(name) {
  await sleep(700);
  console.log(`${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
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
  await sleep(600);
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
hook('setHoldSeconds', 30); // a hold slow enough to photograph the ring

wallView();
await shot('1-first-view');
home();
await tap('replan:yes');
await sleep(1200);
wallView();
await shot('2-conflict-wall');
wallView(0.5, 0.3);
await shot('2b-conflict-bar');
deskView();
await shot('3-conflict-desk');
home();
await tap('cand0');
await sleep(2500);
wallView();
await shot('4-preview-wall');
wallView(0.55, -0.02);
await shot('4b-preview-week');
deskView();
await shot('5-preview-desk');
home();
aim('invite');
await sleep(300);
xr('set-select-value', { device: 'hand-right', value: 1 });
await sleep(9000);
deskView();
await shot('6-hold-ring');
xr('set-select-value', { device: 'hand-right', value: 0 });
home();
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 2);
await sleep(800);
aim('invite');
await sleep(300);
xr('set-select-value', { device: 'hand-right', value: 1 });
await sleep(1900);
xr('set-select-value', { device: 'hand-right', value: 0 });
await sleep(4000);
wallView();
await shot('7-replaced-wall');
deskView();
await shot('8-replaced-desk');
home();
await shot('9-seat-view');
