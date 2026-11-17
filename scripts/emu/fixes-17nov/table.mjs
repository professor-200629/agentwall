// Seated at the emulator room's table: the card rests on the table top, its bar above the surface.
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
async function shot(name) {
  await sleep(800);
  console.log(`shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
}
async function until(test, ms = 40_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (test()) return true;
    await sleep(400);
  }
  return false;
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
const SEAT = { x: -0.75, y: 1.15, z: 0.2 };
xr('set-transform', { device: 'headset', position: SEAT, orientation: { pitch: 0, yaw: 90, roll: 0 } });
hook('simulateNoPlanes', false);
hook('setLateWallSeconds', 90);
hook('restart');
await sleep(3000);
hook('resetDemo');
await sleep(500);
await hook('heard', 'find a time for my app tester call and draft the invite');
await until(() => !hook('interaction').busy && !hook('mural').sweeping, 30_000);
await sleep(1500);

const d = hook('desk');
const planes = hook('planes');
const tables = planes.filter((p) => !p.vertical && p.position[1] > 0.5 && p.position[1] < 1.2);
console.log(`      desk: ${JSON.stringify(d)}`);
console.log(`      table-like planes: ${JSON.stringify(tables.map((p) => ({ label: p.label, y: +p.position[1].toFixed(3) })))}`);
check('seated at the table: the card is on the table', d?.kind === 'desk' && d.visible, d?.kind);
if (d?.kind === 'desk' && tables.length) {
  // The table under the card: the nearest table plane below its centre.
  const top = tables.map((p) => p.position[1]).filter((y) => y < d.position[1]).sort((a, b) => b - a)[0];
  const tilt = (60 * Math.PI) / 180;
  const barBottom = d.position[1] - 0.374 * d.scale * Math.cos(tilt);
  const cardBottom = d.position[1] - 0.26 * d.scale * Math.cos(tilt);
  check('the bottom of the grab bar is above the table top (by under 3 cm)', barBottom >= top - 0.001 && barBottom < top + 0.03, `table ${top.toFixed(3)} m, bar bottom ${barBottom.toFixed(3)} m, card bottom ${cardBottom.toFixed(3)} m, centre ${d.position[1].toFixed(3)} m, scale ${d.scale.toFixed(2)}`);
  check('the card\'s top edge is under 22 cm above the table', d.position[1] + 0.26 * d.scale * Math.cos(tilt) < top + 0.22, `${(d.position[1] + 0.26 * d.scale * Math.cos(tilt) - top).toFixed(3)} m`);
  const eyes = Math.hypot(d.position[0] - SEAT.x, d.position[1] - SEAT.y, d.position[2] - SEAT.z);
  check('it is a comfortable distance from the eyes (60 to 95 cm)', eyes > 0.6 && eyes < 0.95, `${eyes.toFixed(2)} m`);
}
// From the seat, looking down at it; then from the side, level with the table top.
xr('look-at', { device: 'headset', target: { x: d.position[0], y: d.position[1], z: d.position[2] } });
await shot('table-from-seat');
{
  const bd = hook('board').position;
  xr('set-transform', { device: 'headset', position: SEAT, orientation: { pitch: 0, yaw: 90, roll: 0 } });
  xr('look-at', { device: 'headset', target: { x: bd[0], y: (bd[1] + d.position[1]) / 2, z: bd[2] } });
  await shot('table-seat-looking-between-board-and-card');
}
console.log(`\n${pass} passed, ${fail} failed`);
xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
