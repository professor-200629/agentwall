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
  const before = hook('interaction').presses;
  aim(name);
  await sleep(250);
  const hov = hook('interaction');
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(400);
  const after = hook('interaction');
  if (after.presses === before) {
    console.log(`      tap ${name}: NO PRESS (chipHover ${hov.chipHovered} altHover ${hov.altHovered} inviteHover ${hov.inviteHovered} held ${hov.inviteHeld} board ${hov.boardVisible} busy ${hov.busy})`);
  }
}
async function waitIdle(ms = 6000) {
  // Idle = the agent answered AND its sweep across the week has finished.
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return Date.now() - t0;
    await sleep(200);
  }
  return -1;
}

// ---------- 1. Desktop preview ----------
cli(['browser', 'reload']);
await sleep(3000);
hook('resetDemo');
hook('setWatch', false);
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
check('voice gibberish leaves the plan alone and says so', hook('plan').slot?.id === '2026-11-19T16:00' && /not sure/i.test(hook('interaction').agentLine), hook('interaction').agentLine);

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

// ---------- 8. Leave mixed reality and come back ----------
const keep = hook('plan').slot.id;
xr('exit');
await sleep(1500);
b = hook('board');
check('after exit: back to the desktop preview, same cards', hook('state') === 'idle' && b.visible && hook('plan')?.slot?.id === keep, `state=${hook('state')}`);
await enterXr();
check('after re-entering: board finds the wall again, same cards', hook('state') === 'wall' && hook('plan')?.slot?.id === keep, `state=${hook('state')} slot=${hook('plan')?.slot?.id} planes=${hook('planes').length}`);
check('re-entered board is scaled for the far wall', hook('placement')?.scale > 1, `scale=${hook('placement')?.scale?.toFixed(2)}`);

// ---------- 9. No wall: Space Setup tip ----------
hook('simulateNoPlanes', true);
hook('restart');
await sleep(3500);
check('no wall: board floats and suggests Space Setup', hook('state') === 'fallback' && /Space Setup/.test(hook('interaction').agentLine), hook('interaction').agentLine);
hook('simulateNoPlanes', false);
await sleep(1500);
check('wall appears: tip goes away', hook('state') === 'wall' && !/Space Setup/.test(hook('interaction').agentLine), hook('interaction').agentLine);

// ---------- 10. Hold survives the hand ray drifting off the card (pointer capture) ----------
hook('resetDemo');
await tap('chip:task');
await waitIdle();
hook('setHoldSeconds', 3);
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(400);
xr('look-at', { device: 'hand-right', target: { x: -1.5, y: 2.5, z: -2 } }); // ray far off the card
await sleep(3500);
it = hook('interaction');
check('hold keeps going when the ray drifts off the invite mid-hold', hook('plan').approval === 'approved', `approval=${hook('plan').approval} peak=${it.peakHold.toFixed(2)}`);
pinchValue(0);
hook('setHoldSeconds', 1);

// ---------- 11. Unsend and the receipt ----------
hook('setUnsendSeconds', 15); // emulator commands take ~1 s each
look(0);
hook('restart');
await sleep(1500);
hook('setWatch', false);
hook('resetDemo');
await tap('chip:task');
await waitIdle();
check('mural visible after the agent sweeps the week', hook('mural').visible && !hook('mural').sweeping && hook('mural').ruledOut > 0, JSON.stringify(hook('mural')));
const desk1 = hook('desk');
check('invite card placed on a table or above the lap, visible', !!desk1 && desk1.visible && ['desk', 'lap'].includes(desk1.kind), JSON.stringify(desk1));
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(1800);
pinchValue(0);
await sleep(300);
let fl = hook('flow');
box = hook('outbox');
check('hold approves into a 5-second Unsend window', hook('plan').approval === 'approved' && box.length === 1 && box[0].status === 'sending' && fl.sendingLeft > 0, `status=${box[0]?.status} left=${fl.sendingLeft?.toFixed(1)}`);
// The hand still points at the card: pinch again at once (a full tap() costs ~7 s of commands).
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(400);
box = hook('outbox');
check('pinching the card in the window Unsends it', hook('plan').approval === 'needs' && box.length === 0 && /Unsent/.test(hook('interaction').agentLine), hook('interaction').agentLine);
await sleep(1200);
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(1800);
pinchValue(0);
await sleep(16000);
box = hook('outbox');
check('after 5 s it is sent to the demo outbox with a RULES/AI/YOU receipt', box.length === 1 && box[0].status === 'sent' && box[0].receipt?.length === 5 && hook('flow').sendingLeft === null, JSON.stringify(box[0]?.receipt?.map((r) => r.tag)));

hook('setUnsendSeconds', 5);
// ---------- 12. The agent keeps watch ----------
const approvedSlot = hook('plan').slot.id;
hook('watchNow');
await sleep(500);
fl = hook('flow');
check('a SAMPLE change lands on the approved time and the agent flags it', fl.conflict && fl.replan && hook('mural').fresh === 1, JSON.stringify(fl));
await tap('replan:yes');
await waitIdle();
plan = hook('plan');
check('Re-plan moves the invite to a new time and needs a fresh hold', plan.slot.id !== approvedSlot && plan.approval === 'needs' && hook('flow').conflict === null && /Re-planned/.test(hook('interaction').agentLine), `${approvedSlot} -> ${plan.slot.id} | ${hook('interaction').agentLine}`);

// ---------- 13. The desk: real table vs lap ----------
xr('set-transform', { device: 'headset', position: { x: -0.75, y: 1.15, z: 0.2 }, orientation: { pitch: 0, yaw: 90, roll: 0 } });
hook('restart');
await sleep(2000);
check('seated at a real table: the invite goes on the table', hook('desk')?.kind === 'desk', JSON.stringify(hook('desk')));
look(0);
hook('restart');
await sleep(2000);
check('no table within reach: the invite comes above the lap', hook('desk')?.kind === 'lap', JSON.stringify(hook('desk')));

// ---------- 14. Same wall next time ----------
// The emulator room never changes, so every check here has a control: a new
// seat and gaze that would put the board somewhere else without the memory.
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const seat2 = () => xr('set-transform', { device: 'headset', position: { x: 0.35, y: 1.15, z: 0.25 }, orientation: { pitch: 0, yaw: -6, roll: 0 } });
look(0);
hook('forgetWall');
hook('restart');
await sleep(2000);
const spot = hook('board').position;
const mem = hook('wallMemory');
check('the board remembers its wall: label, size and spot', !!mem && mem.label === 'wall' && mem.width > 1 && Math.abs(mem.y - spot[1]) < 0.01, JSON.stringify(mem));
seat2();
hook('restart');
await sleep(2000);
let pl = hook('placement');
let here = hook('board').position;
check('new seat, slightly different gaze: the board comes back to the same spot on the same wall', pl?.remembered === true && dist3(here, spot) < 0.02 && /Back on your wall/.test(hook('interaction').agentLine), `moved ${dist3(here, spot).toFixed(3)} m | ${hook('interaction').agentLine}`);
cli(['browser', 'reload']);
await sleep(3500);
await enterXr();
seat2();
hook('restart');
await sleep(2000);
pl = hook('placement');
here = hook('board').position;
check('after a page reload (saved in the browser) it still comes back to the same spot', pl?.remembered === true && dist3(here, spot) < 0.02, `moved ${dist3(here, spot).toFixed(3)} m remembered=${pl?.remembered}`);
hook('forgetWall');
hook('restart');
await sleep(2000);
here = hook('board').position;
check('control: same seat and gaze WITHOUT the memory put the board elsewhere', hook('placement')?.remembered !== true && dist3(here, spot) > 0.1, `${dist3(here, spot).toFixed(2)} m away`);
const memBefore = JSON.stringify(hook('wallMemory'));
look(90);
hook('restart');
await sleep(2000);
pl = hook('placement');
check('facing another wall: the board goes there as usual, and that wall is remembered next', pl?.kind === 'wall' && pl.remembered !== true && JSON.stringify(hook('wallMemory')) !== memBefore, `kind=${pl?.kind} remembered=${pl?.remembered}`);
look(0);
hook('restart');
await sleep(1500);

// ---------- 15. Fixes from the first real Quest test (steve40, 15 Nov) ----------
look(0);
hook('forgetWall');
hook('restart');
await sleep(2000);
hook('resetDemo');
hook('setWatch', false);
let pp = hook('placement');
const sc = pp.scale;
const at = (lx, ly) => ({ x: pp.position.x + lx * sc, y: pp.position.y + ly * sc, z: pp.position.z });
const aimAt = (p) => {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: p });
};
check('board faces the user square on the front wall', pp.kind === 'wall' && Math.abs(pp.yaw) < 0.05, `yaw=${pp.yaw.toFixed(3)}`);

// "Hard to see the laser pointer": the bare board is now a ray target, so the cursor shows anywhere on it.
aimAt(at(-0.35, 0.4));
await sleep(400);
check('pointing at a bare part of the board shows the cursor (board is a ray target)', hook('interaction').boardHovered === true, JSON.stringify(hook('interaction')));

// "Pointing requires extreme accuracy": a pinch just below a chip (outside it) still hits it.
const chipT = hook('targets')['chip:task'];
const below = { x: chipT[0], y: chipT[1] - (0.0293 + 0.01) * sc, z: chipT[2] };
let pressesBefore = hook('interaction').presses;
aimAt(below);
await sleep(300);
const hov = hook('interaction').chipHovered;
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(400);
await waitIdle();
check('a pinch 1 cm below the chip still presses it (bigger hit area)', hov === 0 && hook('interaction').presses === pressesBefore + 1 && hook('plan')?.slot?.id === '2026-11-17T13:00', `hover=${hov} presses ${pressesBefore}->${hook('interaction').presses}`);

// Hidden buttons must not catch the ray (pointer library hits hidden meshes).
const hiddenYes = hook('targets')['replan:yes'];
pressesBefore = hook('interaction').presses;
aimAt({ x: hiddenYes[0], y: hiddenYes[1], z: hiddenYes[2] });
await sleep(300);
const hidHover = hook('interaction').replanHovered;
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(400);
// The pinch now lands on the touchable week behind it, which is right; the hidden button must stay out of it.
check('the hidden Re-plan button does not catch the ray (IWSDK skips hidden objects)', hidHover === null && hook('flow').replan === false, `hover=${hidHover} replan=${hook('flow').replan}`);

// "No way for me to adjust the position of the board": Move board, then look where you want it.
const startPos = hook('board').position;
hook('setMoveSeconds', 12); // emulator commands take ~1 s each
await tap('move');
check('pinching Move board starts a look-at-a-wall countdown', hook('flow').moving === true && /Look at the spot/.test(hook('interaction').agentLine), hook('interaction').agentLine);
look(30);
for (let i = 0; i < 40 && hook('flow').moving; i++) await sleep(500);
await sleep(2500);
hook('setMoveSeconds', 3);
const moved = hook('board').position;
pp = hook('placement');
check('after the countdown the board moves to where you look, and is remembered there', pp?.kind === 'wall' && !pp.remembered && dist3(moved, startPos) > 0.5 && /Board moved/.test(hook('interaction').agentLine) && Math.abs(hook('wallMemory').fromLeft - mem.fromLeft) > 0.5, `moved ${dist3(moved, startPos).toFixed(2)} m | ${hook('interaction').agentLine}`);

// "Re-centering my headset made the board move to the right side of me": stay on the spot.
look(-60);
hook('recenter');
await sleep(1500);
const afterRecenter = hook('board').position;
check('a headset recenter keeps the board on its spot in the room', dist3(afterRecenter, moved) < 0.02 && /Recentered/.test(hook('interaction').agentLine), `moved ${dist3(afterRecenter, moved).toFixed(3)} m | ${hook('interaction').agentLine}`);
hook('forgetWall');
hook('recenter');
await sleep(4000);
check('control: without the memory the same recenter puts the board somewhere else', dist3(hook('board').position, moved) > 0.3, `${dist3(hook('board').position, moved).toFixed(2)} m`);
look(0);
hook('restart');
await sleep(1500);

// ---------- 16. The week is touchable: remove a rule, pick any free time, ask why ----------
look(0);
hook('restart');
await sleep(2000);
hook('resetDemo');
hook('setWatch', false);
await tap('chip:task');
await waitIdle();
await tap('chip:after4');
await waitIdle();
const days = hook('plan') ? ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'] : [];
const cellPoint = (cell) => {
  const p = hook('muralPoint', days.indexOf(cell.day), cell.start);
  return { x: p[0], y: p[1], z: p[2] };
};
const aimCell = async (cell) => {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: cellPoint(cell) });
  await sleep(400);
};
const pinchNow = async () => {
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(500);
};
let cells = hook('weekCells');
const ruleCell = cells.find((c) => c.kind === 'rule' && c.reason === 'before 4 PM rule' && c.start >= 600);
await aimCell(ruleCell);
const ruleHover = hook('mural').hover;
check('pointing at an amber rule area says what a pinch will do', /Pinch to remove: after 4 PM/.test(ruleHover ?? ''), String(ruleHover));
const slotBefore = hook('plan').slot.id;
await pinchNow();
await waitIdle();
plan = hook('plan');
check('pinching the rule area removes the rule and the agent re-plans', !('after' in plan.constraint) && plan.slot.id !== slotBefore && /Removed your rule "after 4 PM"/.test(hook('interaction').agentLine), `${slotBefore} -> ${plan.slot.id} | ${hook('interaction').agentLine}`);
check('the rule removal is saved for next time', !JSON.parse(hook('saved')).plan.constraint.after, hook('saved').slice(0, 120));

cells = hook('weekCells');
const shown = hook('plan');
// Keep clear of the gold slot and the pills (a pill is about two rows tall).
const nearPill = (c) => [shown.slot, ...shown.alternatives].some((s) => s.day === c.day && Math.abs(s.start - c.start) <= 60);
const freeCell = cells.find((c) => c.kind === 'free' && !nearPill(c) && c.start >= 600);
await aimCell(freeCell);
const freeHover = hook('mural').hover;
check('pointing at a free half hour offers it', /^Pinch: /.test(freeHover ?? ''), String(freeHover));
await pinchNow();
plan = hook('plan');
const wantId = `${freeCell.day}T${String(Math.floor(freeCell.start / 60)).padStart(2, '0')}:${String(freeCell.start % 60).padStart(2, '0')}`;
check('pinching any free time on the wall moves the invite there (you picked it)', plan.slot.id === wantId && plan.by === 'you' && plan.approval === 'needs' && /You picked (Mon|Tue|Wed|Thu|Fri)/.test(hook('interaction').agentLine), `${plan.slot.id} want ${wantId} | ${hook('interaction').agentLine}`);

const busyCell = cells.find((c) => c.kind === 'busy' && c.start >= 600);
await aimCell(busyCell);
await pinchNow();
check('pinching a busy block says why the agent cannot use it', hook('interaction').agentLine.includes(busyCell.reason), `${hook('interaction').agentLine} (want ${busyCell.reason})`);

// ---------- 17. The invite flies from the gold slot on the wall down to the desk ----------
look(0);
hook('restart');
await sleep(2000);
hook('resetDemo');
hook('setFlySlowdown', 6); // 5.4 s flight, so the emulator commands can catch it mid-air
await tap('chip:task');
const m0 = hook('mural');
let sawHidden = !hook('desk')?.visible || m0.flying; // not resting on the desk yet: hidden, or still in the air
let mid = null;
for (let i = 0; i < 30 && !mid; i++) {
  const m = hook('mural');
  if (m.flying) mid = m.deskNow;
  else await sleep(300);
}
await waitIdle(12000);
const rest = hook('desk');
const restNow = hook('mural').deskNow;
check('right after asking, the invite is not resting on the desk yet (hidden or flying)', sawHidden, `hidden=${sawHidden}`);
check('then it flies: mid-air it is above its desk spot', !!mid && mid[1] > rest.position[1] + 0.05, `mid=${mid?.map((v) => v.toFixed(2))} rest y=${rest.position[1].toFixed(2)}`);
check('and lands exactly on its desk spot, ready to hold', rest.visible && dist3(restNow, rest.position) < 0.005 && !hook('mural').sweeping, `off by ${dist3(restNow, rest.position).toFixed(4)} m`);
hook('setFlySlowdown', 1);

// ---------- 18. The agent's next step: prep block, then reminder (each needs your pinch) ----------
look(0);
hook('restart');
await sleep(2000);
hook('resetDemo');
hook('setWatch', false);
hook('setUnsendSeconds', 2);
await tap('chip:task');
await waitIdle();
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(1800);
pinchValue(0);
await sleep(4000); // the 2 s Unsend window passes
let nf = hook('flow');
check('after sending, the agent offers a next step: a 10-min prep block', nf.card === 'prep' && nf.sendingLeft === null, JSON.stringify(nf));
await tap('replan:yes');
nf = hook('flow');
check('yes adds the prep block to your week, then the agent offers a reminder', nf.prep === true && nf.card === 'remind' && /Prep block added/.test(hook('interaction').agentLine), `${JSON.stringify(nf)} | ${hook('interaction').agentLine}`);
const outboxBefore = hook('outbox').length;
await tap('replan:no');
check('no to the reminder: nothing added, the card goes away', hook('outbox').length === outboxBefore && hook('flow').card === null && /no reminder/.test(hook('interaction').agentLine), hook('interaction').agentLine);
hook('setUnsendSeconds', 5);

look(0, -10);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
