// Replays the tap sequence that used to lose every pinch after an "Also free" tap
// (IWSDK drops a release that ends on empty space unless the ray is captured).
// Usage: node scripts/emu/pinch-replay.mjs [selectSeconds]
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const aim = (name) => { const t = hook('targets')[name]; run(['xr', 'set-transform'], { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } }); run(['xr', 'look-at'], { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } }); };
const dur = Number(process.argv[2] ?? 0.2);
async function tap(name) {
  const a = hook('interaction'); const c0 = hook('flow').clock;
  aim(name); await sleep(250);
  const t0 = Date.now(); run(['xr', 'select'], { device: 'hand-right', duration: dur }); const t1 = Date.now();
  await sleep(400);
  const b = hook('interaction'); const c1 = hook('flow').clock;
  console.log(`${name.padEnd(12)} presses ${a.presses}->${b.presses} ${b.presses > a.presses ? 'ok  ' : 'LOST'} | select cmd ${t1 - t0} ms | app clock +${(c1 - c0).toFixed(2)} s | plan ${hook('plan')?.slot?.id}`);
}
try { run(['xr', 'enter']); } catch (e) { console.log('enter:', e.message.slice(0, 80)); }
await sleep(1500);
run(['xr', 'set-input-mode'], { mode: 'hand' }); run(['xr', 'set-connected'], { device: 'hand-right', connected: true });
run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('simulateNoPlanes', false); hook('restart'); await sleep(2000);
hook('resetDemo'); hook('setWatch', false);
await tap('chip:task'); await sleep(2500);
await tap('chip:after4'); await sleep(2500);
await tap('alt0');
await tap('invite');
await tap('alt0');
await tap('chip:notwed'); await sleep(2500);
await tap('chip:any'); await sleep(2500);
await tap('alt1');
await tap('chip:thu');
