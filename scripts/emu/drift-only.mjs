// Runs only the "hold survives drift" check (used to compare with/without pointer capture).
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
run(['browser', 'reload']); await sleep(3500);
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-connected'], { device: 'hand-right', connected: true });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('restart'); await sleep(1500);
hook('resetDemo');
await hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(500);
hook('setHoldSeconds', 3);
const t = hook('targets').invite;
run(['xr', 'set-transform'], { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
await sleep(300);
run(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
await sleep(400);
run(['xr', 'look-at'], { device: 'hand-right', target: { x: -1.5, y: 2.5, z: -2 } });
await sleep(3500);
console.log('approval:', hook('plan').approval, '| peak hold:', hook('interaction').peakHold.toFixed(2));
run(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
hook('setHoldSeconds', 1);
