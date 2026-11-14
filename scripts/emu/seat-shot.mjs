// Screenshot from the seated position (what the user really sees), with a plan on the board.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })).data;
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: -3, yaw: 0, roll: 0 } });
hook('restart');
await sleep(1500);
hook('resetDemo');
await hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(800);
console.log('scale', hook('placement')?.scale, run(['browser', 'screenshot'], {}).screenshotPath);
