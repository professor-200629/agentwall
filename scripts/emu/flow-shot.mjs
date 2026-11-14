// Screenshots of the whole new flow from the desk seat: needs approval -> Unsend window ->
// receipt -> the agent's re-plan card. Prints one screenshot path per step.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => console.log(`SHOT ${name} ${run(['browser', 'screenshot'], {}).screenshotPath}`);
const seat = { x: -0.75, y: 1.15, z: 0.2 };
const view = (pitch) => run(['xr', 'set-transform'], { device: 'headset', position: seat, orientation: { pitch, yaw: 90, roll: 0 } });
run(['browser', 'reload']); await sleep(3500);
try { run(['xr', 'enter']); } catch {}
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-connected'], { device: 'hand-right', connected: true });
view(0);
hook('setWatch', false);
hook('simulateNoPlanes', false);
hook('restart'); await sleep(2000);
hook('resetDemo');
hook('setUnsendSeconds', 14);
console.log('desk', JSON.stringify(hook('desk')));
await hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(2600);
// Hand rests near the table, out of the way of the view.
const d = hook('desk');
run(['xr', 'set-transform'], { device: 'hand-right', position: { x: seat.x - 0.25, y: 0.95, z: seat.z + 0.25 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'hand-right', target: { x: d.position[0], y: d.position[1], z: d.position[2] } });
view(-22); await sleep(500);
shot('1-needs-approval');
run(['xr', 'set-select-value'], { device: 'hand-right', value: 1 }); await sleep(1800);
run(['xr', 'set-select-value'], { device: 'hand-right', value: 0 }); await sleep(300);
console.log('flow', JSON.stringify(hook('flow')));
shot('2-unsend-window');
await sleep(14000);
console.log('outbox', JSON.stringify(hook('outbox').map((o) => [o.status, o.receipt?.length])));
shot('3-receipt');
hook('watchNow'); await sleep(800);
console.log('flow', JSON.stringify(hook('flow')));
view(-8); await sleep(400);
shot('4-replan');
hook('setUnsendSeconds', 5);
