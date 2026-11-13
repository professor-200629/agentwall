// Close screenshot of the whole board after an AI-planned rule (fake AI) and one approval.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })).data;
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
hook('resetDemo');
hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(500);
hook('fakeAi', {
  intent: 'rule',
  rule: { after: '16:00', before: null, day: null, notDays: [] },
  slotId: '2026-11-18T17:30',
  reason: 'Wednesday 5:30 PM is the first time after 4 PM when Sam is off shift.',
  body: 'Hi Sam,\n\nCould we meet on Wednesday 18 Nov, 5:30 – 6:00 PM IST to walk through your app test notes?\n\nThanks,\nBalu',
}, 200);
hook('heard', 'only after 4 PM please');
await sleep(800);
hook('fakeAi', null);
const b = hook('board').position;
run(['xr', 'set-transform'], { device: 'headset', position: { x: b[0], y: b[1] + 0.02, z: b[2] + 0.95 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'set-transform'], { device: 'hand-right', position: { x: b[0] + 0.3, y: b[1] - 0.5, z: b[2] + 0.7 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
await sleep(600);
console.log(run(['browser', 'screenshot'], {}).screenshotPath);
