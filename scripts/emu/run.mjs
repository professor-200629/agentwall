// Emulator checks for Agent Wall. Needs the dev server running:
//   npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/run.mjs
// Pinches are real emulated hand-ray pinches (aim the right hand, then select).
import { execFileSync } from 'node:child_process';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const out = execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(json.error?.message ?? json)}`);
  return json.data;
}
const xr = (action, input = {}) => cli(['xr', action], input);
function hook(fn, ...args) {
  process.env.AGENTWALL_CALL = JSON.stringify({ fn, args });
  return cli(['browser', 'run', 'scripts/emu/call.mjs']).result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const fmt = (a) => a.map((v) => v.toFixed(2)).join(', ');
const look = (yaw, pitch = 0) =>
  xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch, yaw, roll: 0 } });

async function enterXr() {
  try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
  await sleep(1500);
  xr('set-input-mode', { mode: 'hand' });
  xr('set-connected', { device: 'hand-right', connected: true });
  look(0);
  hook('simulateNoPlanes', false);
  hook('restart');
  await sleep(1500);
}
function aim(name) {
  const t = hook('targets')[name];
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
const pinchValue = (value) => xr('set-select-value', { device: 'hand-right', value });
async function tap(name) {
  aim(name);
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(400);
}
async function waitIdle(ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy) return Date.now() - t0;
    await sleep(200);
  }
  return -1;
}

// ---------- 1. Desktop preview ----------
cli(['browser', 'reload']);
await sleep(3000);
hook('resetDemo');
let b = hook('board');
check('desktop: board visible as a preview before XR', hook('state') === 'idle' && b.visible, `pos=${fmt(b.position)}`);

// ---------- 2. Placement ----------
await enterXr();
const planes = hook('planes');
console.log(`      planes reported: ${planes.length} (${planes.filter((p) => p.vertical).length} vertical)`);
let p = hook('placement');
b = hook('board');
check('XR: board placed on a detected wall', hook('state') === 'wall' && p?.kind === 'wall', `dist=${p?.distance?.toFixed(2)} m pos=${fmt(b.position)}`);
const wall = planes.find((q) => q.id === p?.planeId);
check('XR: chosen plane is vertical and labelled wall', !!wall && wall.vertical && (wall.label ?? 'wall') === 'wall', wall?.label);
for (const yaw of [90, 180, 270]) {
  look(yaw);
  hook('restart');
  await sleep(3500);
  p = hook('placement');
  b = hook('board');
  check(`XR: looking ${yaw}°: placed (${p?.kind})`, !!p && b.visible, `yaw=${((b.yaw * 180) / Math.PI).toFixed(0)}° dist=${p?.distance?.toFixed(2)}`);
}
look(0);
hook('simulateNoPlanes', true);
hook('restart');
await sleep(1000);
check('no planes: still searching before 2.5 s', hook('state') === 'searching', hook('state'));
await sleep(2500);
b = hook('board');
check('no planes: fallback 1.2 m in front at eye height', hook('placement')?.kind === 'fallback' && Math.abs(b.position[2] + 1.2) < 0.05 && Math.abs(b.position[1] - 1.2) < 0.05, `pos=${fmt(b.position)}`);
hook('simulateNoPlanes', false);
await sleep(1500);
check('late wall: board moves from fallback to wall', hook('state') === 'wall', hook('state'));

// ---------- 3. Asking by chip (no AI configured in dev: rules) ----------
hook('resetDemo');
check('fresh board starts empty (agent waits to be asked)', hook('plan') === null);
await tap('chip:task');
await waitIdle();
let plan = hook('plan');
check('chip "Find time + draft invite": two linked cards, Tue 1:00 PM', plan?.slot?.id === '2026-11-17T13:00' && plan.linked && plan.approval === 'needs', plan?.invite?.subject);
check('board says who planned it (rules, AI not set up)', plan?.by === 'rules' && /AI not set up/.test(hook('interaction').agentLine), hook('interaction').agentLine);
const v1 = plan.version;
await tap('chip:after4');
await waitIdle();
plan = hook('plan');
check('chip "Only after 4 PM": slot moves to Wed 5:30 PM, invite rewritten', plan?.slot?.id === '2026-11-18T17:30' && plan.invite.body.includes('Wednesday 18 Nov') && plan.version > v1 && plan.linked, plan?.invite?.subject);
check('rule line shows the rule', plan?.constraintText === 'only after 4 PM', plan?.constraintText);

// ---------- 4. Pinch an alternative, pinch-and-hold approval ----------
aim('alt0');
await sleep(400);
check('hand ray hovering "Also free" row 1 highlights it', hook('interaction').altHovered === 0);
await tap('alt0');
plan = hook('plan');
check('pinching "Also free" row 1 uses Thu 4:00 PM and rewrites the invite', plan?.slot?.id === '2026-11-19T16:00' && plan.linked && plan.invite.subject.includes('Thu 19 Nov'), plan?.invite?.subject);
check('after the swap the invite needs approval', plan?.approval === 'needs');
await tap('invite');
check('a short pinch (0.2 s) does not approve', hook('plan').approval === 'needs' && hook('outbox').length === 0);
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(1800);
let it = hook('interaction');
plan = hook('plan');
let box = hook('outbox');
check('pinch and hold ~1 s: ring filled', it.peakHold > 0.5, `peakHold=${it.peakHold.toFixed(2)}`);
check('pinch and hold ~1 s: approved, in the outbox once', plan.approval === 'approved' && box.length === 1 && box[0].subject === plan.invite.subject);
await sleep(1200);
check('still holding does not approve a second time', hook('outbox').length === 1);
pinchValue(0);
await sleep(300);
check('ring hidden after release', hook('interaction').hold === 0);
await tap('alt0');
plan = hook('plan');
check('a change after approval resets the invite to "needs approval"', plan.approval === 'needs' && plan.linked, plan.slot?.id);

// ---------- 5. AI path (fake AI inside the running app) ----------
const aiAnswer = {
  intent: 'rule',
  rule: { after: null, before: null, day: null, notDays: ['2026-11-18'] },
  slotId: '2026-11-19T16:30',
  reason: 'Thursday 4:30 PM avoids Wednesday and leaves Sam a gap after class.',
  body: 'Hi Sam,\n\nHow about Thursday 19 Nov, 4:30 – 5:00 PM IST to go through your app test notes?\n\nThanks,\nBalu',
};
hook('fakeAi', aiAnswer, 300);
await tap('chip:notwed');
await waitIdle();
plan = hook('plan');
check('AI answer used: Thu 4:30 PM, AI-written email', plan?.by === 'ai' && plan.slot?.id === '2026-11-19T16:30' && plan.invite.source === 'ai' && plan.invite.body === aiAnswer.body, `${plan?.slot?.id} ${plan?.invite?.source}`);
check('board credits the AI', /Planned by AI/.test(hook('interaction').agentLine), hook('interaction').agentLine);

hook('fakeAi', { ...aiAnswer, intent: 'clear', rule: { after: null, before: null, day: null, notDays: [] }, slotId: '2026-11-17T13:00', body: 'Hi Sam, Friday 9 AM?' }, 6000);
await tap('chip:any');
await waitIdle(8000);
plan = hook('plan');
it = hook('interaction');
check('AI too slow: rules answer after ~3 s (measured in the app)', plan?.by === 'rules' && /too slow/.test(it.agentLine) && it.lastAskMs >= 2900 && it.lastAskMs < 3600, `${it.agentLine} (${it.lastAskMs} ms)`);
check('slow AI fallback still gives the right slot (any time -> Tue 1:00 PM)', plan?.slot?.id === '2026-11-17T13:00');

hook('fakeAi', 'offline');
await tap('chip:thu');
await waitIdle();
plan = hook('plan');
check('AI offline: rules plan "Thursday" (Thu 12:30 PM)', plan?.by === 'rules' && plan.slot?.id === '2026-11-19T12:30' && /offline/.test(hook('interaction').agentLine), `${plan?.slot?.id} ${hook('interaction').agentLine}`);

hook('fakeAi', null);
await tap('chip:any'); // clear the rule first (rules), then turn the lying AI on
await waitIdle();
hook('fakeAi', { ...aiAnswer, intent: 'rule', rule: { after: '16:00', before: null, day: null, notDays: [] }, slotId: '2026-11-17T13:00', body: 'Hi Sam, Tuesday 1:00 PM?' }, 100);
await tap('chip:after4');
await waitIdle();
plan = hook('plan');
check('AI slot that breaks its own rule is overridden', plan?.slot?.id === '2026-11-18T17:30' && plan.invite.source === 'rules' && /did not fit/.test(plan.note), `${plan?.slot?.id} note=${plan?.note}`);
hook('fakeAi', null);

// ---------- 6. Voice transcript (the emulator has no microphone) ----------
await tap('chip:any');
await waitIdle();
await hook('heard', 'can we do it on Thursday after 4');
await waitIdle();
plan = hook('plan');
check('voice transcript "Thursday after 4" -> Thu 4:00 PM, and the board shows what it heard', plan?.slot?.id === '2026-11-19T16:00' && /Heard: “can we do it on Thursday after 4”/.test(hook('interaction').agentLine), `${plan?.slot?.id} | ${hook('interaction').agentLine}`);
await hook('heard', 'what is the weather');
await waitIdle();
check('voice gibberish leaves the plan alone and says so', hook('plan').slot?.id === '2026-11-19T16:00' && /not sure/.test(hook('interaction').agentLine), hook('interaction').agentLine);

// ---------- 7. Saved board survives a reload ----------
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(1800);
pinchValue(0);
await sleep(300);
const before = hook('plan');
const boxBefore = hook('outbox').length;
check('saved to localStorage', !!hook('saved'));
cli(['browser', 'reload']);
await sleep(3500);
plan = hook('plan');
check('after reload: same plan restored', plan?.slot?.id === before.slot.id && plan.approval === before.approval && plan.linked, `${plan?.slot?.id} ${plan?.approval}`);
check('after reload: outbox restored', hook('outbox').length === boxBefore, `outbox=${hook('outbox').length}`);
check('after reload: "Welcome back" shown', /Welcome back/.test(hook('interaction').agentLine), hook('interaction').agentLine);
await enterXr();
check('after reload: board placed again with the saved cards', hook('board').visible && hook('cards').every((c) => c.visible));

look(0, -10);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
