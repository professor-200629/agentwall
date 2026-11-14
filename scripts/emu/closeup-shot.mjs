// Close-up of the mural's lower right (the "Also free" pills) from 0.6 m.
import { execFileSync } from 'node:child_process';
const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
const run = (args, input) => { const o = JSON.parse(execFileSync(process.execPath, [CLI, ...args, ...(input ? ['--input-json', JSON.stringify(input)] : [])], { encoding: 'utf8', timeout: 90000 })); if (o.ok === false) throw new Error(o.error?.message); return o.data; };
const hook = (fn, ...args) => { process.env.AGENTWALL_CALL = JSON.stringify({ fn, args }); return run(['browser', 'run', 'scripts/emu/call.mjs']).result; };
const t = hook('targets');
const a = t.alt0, b = t.alt1;
const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2 };
run(['xr', 'set-transform'], { device: 'headset', position: { x: mid.x - 0.1, y: mid.y + 0.05, z: mid.z + 0.6 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
run(['xr', 'look-at'], { device: 'headset', target: mid });
await new Promise((r) => setTimeout(r, 600));
console.log('alt0', a.map((v) => v.toFixed(2)).join(','), 'alt1', b.map((v) => v.toFixed(2)).join(','));
console.log('shot', run(['browser', 'screenshot'], {}).screenshotPath);
