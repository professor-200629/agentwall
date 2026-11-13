// Screenshots of the Day 3 states: amber glow, ring mid-fill, approved + outbox.
// Needs the headless dev server. Prints the screenshot paths.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => {
  const out = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 }));
  if (out.ok === false) throw new Error(`${args.join(' ')}: ${out.error?.message}`);
  return out.data;
};
const hook = (fn, ...args) => {
  process.env.AGENTWALL_CALL = JSON.stringify({ fn, args });
  return run(['browser', 'run', 'scripts/emu/call.mjs']).result;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => console.log(name, run(['browser', 'screenshot'], {}).screenshotPath);

if (hook('state') === 'idle') {
  run(['xr', 'enter']);
  await sleep(1500);
}
run(['xr', 'set-input-mode'], { mode: 'hand' });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('simulateNoPlanes', false);
hook('restart');
await sleep(1500);
hook('resetDemo');
hook('setAfter', 16, 'only after 4 PM');
hook('setHoldSeconds', 8);
// Step closer so the board fills the view.
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.15, z: -1.25 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
const t = hook('targets').invite;
run(['xr', 'set-transform'], { device: 'hand-right', position: { x: 0.15, y: 0.95, z: -0.95 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
run(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
await sleep(500);
shot('glow');
run(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
await sleep(3000);
console.log('hold', hook('interaction').hold.toFixed(2));
shot('ring');
hook('setHoldSeconds', 0.3);
await sleep(1200);
run(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
await sleep(1000);
console.log('approval', hook('plan').approval, 'outbox', hook('outbox').length);
shot('approved');
hook('setHoldSeconds', 1);
