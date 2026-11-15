// Screenshots of the touchable week: hovering a rule area, then a free time.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-connected'], { device: 'hand-right', connected: true });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('setWatch', false); hook('simulateNoPlanes', false); hook('restart'); await sleep(2000);
hook('resetDemo');
await hook('heard', 'only after 4 PM, not Wednesday'); await sleep(2800);
const m = hook('targets').mural;
// Stand 1.3 m from the wall, a little low, so the mural fills the view.
run(['xr', 'set-transform'], { device: 'headset', position: { x: m[0], y: m[1], z: m[2] + 0.95 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'headset', target: { x: m[0], y: m[1], z: m[2] } });
const aim = (cell) => {
  const p = hook('muralPoint', days.indexOf(cell.day), cell.start);
  run(['xr', 'set-transform'], { device: 'hand-right', position: { x: m[0] + 0.3, y: m[1] - 0.3, z: m[2] + 0.75 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  run(['xr', 'look-at'], { device: 'hand-right', target: { x: p[0], y: p[1], z: p[2] } });
};
let cells = hook('weekCells');
aim(cells.find((c) => c.kind === 'rule' && c.reason === 'not Wed rule' && c.start >= 660));
await sleep(600);
console.log('hover', hook('mural').hover, 'SHOT rule', run(['browser', 'screenshot'], {}).screenshotPath);
const p = hook('plan');
const near = (c) => [p.slot, ...p.alternatives].some((s) => s.day === c.day && Math.abs(s.start - c.start) <= 60);
const isShown = (c) => [p.slot, ...p.alternatives].some((s) => s.day === c.day && Math.abs(s.start - c.start) <= 30);
aim(cells.find((c) => c.kind === 'free' && !near(c)) ?? cells.find((c) => c.kind === 'free' && !isShown(c)));
await sleep(600);
console.log('hover', hook('mural').hover, 'SHOT free', run(['browser', 'screenshot'], {}).screenshotPath);
