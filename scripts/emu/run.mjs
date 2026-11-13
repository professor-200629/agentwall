// Emulator checks for board placement. Needs the dev server running:
//   npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/run.mjs
import { execFileSync } from 'node:child_process';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const out = execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(json.error ?? json)}`);
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

// Seated user, looking at yaw degrees (0 = -Z).
function look(yaw, pitch = 0) {
  xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch, yaw, roll: 0 } });
}

// 1. Desktop preview before entering XR.
cli(['browser', 'reload']);
await sleep(2500);
let b = hook('board');
check('desktop: board visible as a preview before XR', hook('state') === 'idle' && b.visible, `state=${hook('state')} pos=${fmt(b.position)}`);

// 2. Enter XR with hands only.
try { xr('enter'); } catch (e) { console.log('enter:', e.message.slice(0, 160)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
look(0);
hook('simulateNoPlanes', false);
hook('restart');
await sleep(1500);
const planes = hook('planes');
console.log(`      planes reported: ${planes.length} (${planes.filter((p) => p.vertical).length} vertical; labels ${[...new Set(planes.map((p) => p.label))].join('/')})`);
let p = hook('placement');
b = hook('board');
check('XR: board placed on a detected wall', hook('state') === 'wall' && p?.kind === 'wall', `state=${hook('state')} plane=${p?.planeId} dist=${p?.distance?.toFixed(2)} m pos=${fmt(b.position)}`);
const wallPlane = planes.find((q) => q.id === p?.planeId);
check('XR: chosen plane is vertical and labelled wall', !!wallPlane && wallPlane.vertical && (wallPlane.label ?? 'wall') === 'wall', JSON.stringify(wallPlane));

// 3. Each direction: on a wall or, if none in front, the fallback.
for (const yaw of [90, 180, 270]) {
  look(yaw);
  hook('restart');
  await sleep(3500);
  p = hook('placement');
  b = hook('board');
  check(`XR: looking ${yaw}°: placed (${p?.kind})`, !!p && b.visible, `pos=${fmt(b.position)} yaw=${(b.yaw * 180 / Math.PI).toFixed(0)}° dist=${p?.distance?.toFixed(2)}`);
}

// 4. No planes (like a Quest without Space Setup): fallback 1.2 m ahead at eye height.
look(0);
hook('simulateNoPlanes', true);
hook('restart');
await sleep(1000);
check('no planes: still searching before 2.5 s', hook('state') === 'searching', hook('state'));
await sleep(2500);
p = hook('placement');
b = hook('board');
const ok = p?.kind === 'fallback' && Math.abs(b.position[2] + 1.2) < 0.05 && Math.abs(b.position[1] - 1.2) < 0.05 && Math.abs(b.position[0]) < 0.05;
check('no planes: fallback 1.2 m in front at eye height', ok, `state=${hook('state')} pos=${fmt(b.position)}`);

// 5. Planes show up late: board moves from the fallback to the wall.
hook('simulateNoPlanes', false);
await sleep(1500);
check('late wall: board moves from fallback to wall', hook('state') === 'wall', hook('state'));

// 6. Day 2: two linked cards.
let plan = hook('plan');
check('cards: agent made a plan with a slot and an invite', !!plan?.slot && !!plan?.invite, plan?.slot?.id);
check('cards: default slot is Tue 1:00 PM', plan?.slot?.id === '2026-11-17T13:00', plan?.invite?.subject);
check('cards: invite is linked to the slot and needs approval', plan?.linked === true && plan?.approval === 'needs', `linked=${plan?.linked} approval=${plan?.approval}`);
const v1 = plan.version;
hook('setAfter', 16, 'only after 4 PM');
plan = hook('plan');
check('rule "only after 4 PM": slot moves to Wed 5:30 PM', plan?.slot?.id === '2026-11-18T17:30', plan?.slot?.id);
check('rule change rewrites the invite and keeps the link', plan?.linked === true && plan.invite.body.includes('Wednesday 18 Nov') && plan.version > v1, plan?.invite?.subject);
check('board shows both cards', hook('cards').every((c) => c.visible), JSON.stringify(hook('cards')));

// 7. Day 3: real hand pinches.
const v = (a) => ({ x: a[0], y: a[1], z: a[2] });
function aim(name) {
  const t = hook('targets')[name];
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: v(t) });
  return t;
}
const pinch = (value) => xr('set-select-value', { device: 'hand-right', value });

look(0);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
pinch(0);
hook('resetDemo');
hook('setAfter', 16, 'only after 4 PM');
await sleep(300);

aim('alt0');
await sleep(400);
check('hand ray hovering "Also free" row 1 highlights it', hook('interaction').altHovered === 0, JSON.stringify(hook('interaction')));
pinch(1);
await sleep(300);
pinch(0);
await sleep(300);
plan = hook('plan');
check('pinching "Also free" row 1 uses Thu 4:00 PM and rewrites the invite', plan?.slot?.id === '2026-11-19T16:00' && plan.linked && plan.invite.subject.includes('Thu 19 Nov'), plan?.invite?.subject);
check('after the swap the invite needs approval', plan?.approval === 'needs', plan?.approval);

aim('invite');
await sleep(400);
check('hand ray hovering the invite', hook('interaction').inviteHovered === true, JSON.stringify(hook('interaction')));
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(600);
check('a short pinch (0.2 s) does not approve', hook('plan').approval === 'needs' && hook('outbox').length === 0, `approval=${hook('plan').approval} outbox=${hook('outbox').length}`);

pinch(1);
await sleep(1800);
let it = hook('interaction');
plan = hook('plan');
let box = hook('outbox');
check('pinch and hold ~1 s: ring filled', it.peakHold > 0.5, `peakHold=${it.peakHold.toFixed(2)}`);
check('pinch and hold ~1 s: invite approved', plan.approval === 'approved', plan.approval);
check('approved invite is in the demo outbox (once)', box.length === 1 && box[0].subject === plan.invite.subject, JSON.stringify(box.map((b) => b.subject)));
await sleep(1500);
check('still holding does not approve a second time', hook('outbox').length === 1, `outbox=${hook('outbox').length}`);
pinch(0);
await sleep(300);
check('ring hidden after release', hook('interaction').hold === 0, `hold=${hook('interaction').hold}`);

// Changing the plan after approval needs a fresh approval.
aim('alt0');
await sleep(300);
pinch(1);
await sleep(300);
pinch(0);
await sleep(300);
plan = hook('plan');
check('a change after approval resets the invite to "needs approval"', plan.approval === 'needs' && plan.linked, `${plan.approval} ${plan.slot?.id}`);
aim('invite');
await sleep(300);
pinch(1);
await sleep(1800);
pinch(0);
await sleep(300);
box = hook('outbox');
check('approving the new invite adds a second outbox item, newest first', box.length === 2 && box[0].slotId === hook('plan').slot.id, JSON.stringify(box.map((b) => b.slotId)));

look(0, -10);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
