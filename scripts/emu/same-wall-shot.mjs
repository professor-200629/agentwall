// Screenshot: a second session from another seat; the board is back on the same spot.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('forgetWall'); hook('setWatch', false); hook('simulateNoPlanes', false);
hook('restart'); await sleep(2000);
await hook('heard', 'only after 4 PM'); await sleep(2500);
console.log('first spot', hook('board').position.map((v) => v.toFixed(2)).join(','));
// Next session from another seat, looking elsewhere.
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0.35, y: 1.15, z: 0.25 }, orientation: { pitch: 0, yaw: -18, roll: 0 } });
hook('restart'); await sleep(2000);
const b = hook('board').position;
console.log('back at', b.map((v) => v.toFixed(2)).join(','), 'remembered', hook('placement')?.remembered);
run(['xr', 'look-at'], { device: 'headset', target: { x: b[0], y: b[1], z: b[2] } });
await sleep(600);
console.log('shot', run(['browser', 'screenshot'], {}).screenshotPath);
