// Emulator checks for board placement. Needs the dev server running:
//   npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/run.mjs
import { execFileSync } from 'node:child_process';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const out = execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(json.error ?? json)}`);
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
const fmt = (a) => a.map((v) => v.toFixed(2)).join(', ');

// Seated user, looking at yaw degrees (0 = -Z).
function look(yaw, pitch = 0) {
  xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch, yaw, roll: 0 } });
}

// 1. Desktop preview before entering XR.
cli(['browser', 'reload']);
await sleep(2500);
let b = hook('board');
check('desktop: board visible as a preview before XR', hook('state') === 'idle' && b.visible, `state=${hook('state')} pos=${fmt(b.position)}`);

// 2. Enter XR with hands only.
try { xr('enter'); } catch (e) { console.log('enter:', e.message.slice(0, 160)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
look(0);
hook('simulateNoPlanes', false);
hook('restart');
await sleep(1500);
const planes = hook('planes');
console.log(`      planes reported: ${planes.length} (${planes.filter((p) => p.vertical).length} vertical; labels ${[...new Set(planes.map((p) => p.label))].join('/')})`);
let p = hook('placement');
b = hook('board');
check('XR: board placed on a detected wall', hook('state') === 'wall' && p?.kind === 'wall', `state=${hook('state')} plane=${p?.planeId} dist=${p?.distance?.toFixed(2)} m pos=${fmt(b.position)}`);
const wallPlane = planes.find((q) => q.id === p?.planeId);
check('XR: chosen plane is vertical and labelled wall', !!wallPlane && wallPlane.vertical && (wallPlane.label ?? 'wall') === 'wall', JSON.stringify(wallPlane));

// 3. Each direction: on a wall or, if none in front, the fallback.
for (const yaw of [90, 180, 270]) {
  look(yaw);
  hook('restart');
  await sleep(3500);
  p = hook('placement');
  b = hook('board');
  check(`XR: looking ${yaw}°: placed (${p?.kind})`, !!p && b.visible, `pos=${fmt(b.position)} yaw=${(b.yaw * 180 / Math.PI).toFixed(0)}° dist=${p?.distance?.toFixed(2)}`);
}

// 4. No planes (like a Quest without Space Setup): fallback 1.2 m ahead at eye height.
look(0);
hook('simulateNoPlanes', true);
hook('restart');
await sleep(1000);
check('no planes: still searching before 2.5 s', hook('state') === 'searching', hook('state'));
await sleep(2500);
p = hook('placement');
b = hook('board');
const ok = p?.kind === 'fallback' && Math.abs(b.position[2] + 1.2) < 0.05 && Math.abs(b.position[1] - 1.2) < 0.05 && Math.abs(b.position[0]) < 0.05;
check('no planes: fallback 1.2 m in front at eye height', ok, `state=${hook('state')} pos=${fmt(b.position)}`);

// 5. Planes show up late: board moves from the fallback to the wall.
hook('simulateNoPlanes', false);
await sleep(1500);
check('late wall: board moves from fallback to wall', hook('state') === 'wall', hook('state'));

look(0, -10);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
