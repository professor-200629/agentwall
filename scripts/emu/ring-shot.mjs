// Close-up of the approval ring mid-fill (hold stretched to 8 s for the shot).
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })).data;
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
hook('resetDemo');
hook('setHoldSeconds', 8);
const t = hook('targets').invite;
run(['xr', 'set-transform'], { device: 'headset', position: { x: t[0], y: t[1], z: t[2] + 0.45 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'set-transform'], { device: 'hand-right', position: { x: t[0] + 0.12, y: t[1] - 0.2, z: t[2] + 0.35 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
run(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
await sleep(4500);
console.log('hold', hook('interaction').hold.toFixed(2), run(['browser', 'screenshot'], {}).screenshotPath);
run(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
hook('setHoldSeconds', 1);
hook('resetDemo');
