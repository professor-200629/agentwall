// Seat the user at the emulator room's desk (facing the left wall): board on the wall, invite on the table.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
const seat = { x: Number(process.env.SX ?? -0.75), y: 1.15, z: Number(process.env.SZ ?? 0.2) };
run(['xr', 'set-transform'], { device: 'headset', position: seat, orientation: { pitch: 0, yaw: 90, roll: 0 } });
hook('setWatch', false);
hook('restart'); await sleep(2000);
console.log('placement', hook('placement')?.kind, JSON.stringify(hook('board').position.map((v) => +v.toFixed(2))), 'desk', JSON.stringify(hook('desk')));
hook('resetDemo');
await hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(2600);
run(['xr', 'set-transform'], { device: 'headset', position: seat, orientation: { pitch: -22, yaw: 90, roll: 0 } });
await sleep(500);
console.log('shot', run(['browser', 'screenshot'], {}).screenshotPath);
