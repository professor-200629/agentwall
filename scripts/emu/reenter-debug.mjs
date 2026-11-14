// Debug: replicate the suite's exit/re-enter steps exactly, print what the app sees.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const look = () => run(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
async function enterXr(tag) {
  try { run(['xr', 'enter']); } catch (e) { console.log(tag, 'enter error:', e.message.slice(0, 100)); }
  await sleep(1500);
  run(['xr', 'set-input-mode'], { mode: 'hand' });
  run(['xr', 'set-connected'], { device: 'hand-right', connected: true });
  look();
  hook('simulateNoPlanes', false);
  hook('restart');
  await sleep(1500);
}
const report = (label) => {
  const s = run(['xr', 'status']).result;
  console.log(label, '| state', hook('state'), '| planes', hook('planes').length, '| session', s.sessionActive, '| board', JSON.stringify(hook('board').position.map((v) => +v.toFixed(2))));
};
run(['browser', 'reload']); await sleep(3500);
await enterXr('A'); report('session 1');
for (let i = 2; i <= 6; i++) {
  run(['xr', 'exit']);
  await sleep(1500);
  await enterXr(String(i));
  report(`session ${i}`);
}
