// Screenshots of the new flow: the agent's sweep mid-way, the finished mural, and the desk card.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => console.log(name, run(['browser', 'screenshot'], {}).screenshotPath);
run(['browser', 'reload']); await sleep(3500);
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('setWatch', false);
hook('simulateNoPlanes', false);
hook('restart'); await sleep(1500);
hook('resetDemo');
console.log('placement', JSON.stringify(hook('placement')?.kind), 'desk', JSON.stringify(hook('desk')));
const b = hook('board').position;
run(['xr', 'set-transform'], { device: 'headset', position: { x: b[0], y: b[1] + 0.05, z: b[2] + 1.15 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
await hook('heard', 'only after 4 PM');
await sleep(500);
shot('sweep');
await sleep(2000);
console.log('mural', JSON.stringify(hook('mural')));
shot('mural');
// Look at the desk card from the seat.
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: -35, yaw: 0, roll: 0 } });
const d = hook('desk');
if (d) run(['xr', 'look-at'], { device: 'headset', target: { x: d.position[0], y: d.position[1], z: d.position[2] } });
await sleep(600);
shot('desk');
