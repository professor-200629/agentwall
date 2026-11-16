// Emulator checks for the two changes a Meta mentor asked for after trying the app on a Quest 3:
// the desk card sits farther away, and the board and the card can be grabbed and moved.
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/drag.mjs   (every pinch is a real emulated hand-ray pinch)
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
function evalPage(code) {
  process.env.AGENTWALL_PAGE = JSON.stringify({ do: 'eval', code });
  return cli(['browser', 'run', 'scripts/emu/page.mjs']).result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const shot = (name) => {
  try {
    console.log(`      shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
  } catch (e) {
    console.log(`      shot ${name} failed: ${e.message.slice(0, 100)}`);
  }
};
const HEAD = { x: 0, y: 1.2, z: 0 };
const HAND = { x: 0.18, y: 1.0, z: -0.3 };
const f2 = (a) => a.map((v) => v.toFixed(2)).join(', ');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const fromHead = (p) => Math.hypot(p[0] - HEAD.x, p[1] - HEAD.y, p[2] - HEAD.z);
/** Put the hand at `pos` and point it at a world point. */
function point(target, pos = HAND) {
  xr('set-transform', { device: 'hand-right', position: pos, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: target[0], y: target[1], z: target[2] } });
}
const pinchValue = (value) => xr('set-select-value', { device: 'hand-right', value });
async function waitIdle(ms = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(200);
  }
}
async function enterXr() {
  try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
  await sleep(1500);
  xr('set-input-mode', { mode: 'hand' });
  xr('set-connected', { device: 'hand-right', connected: true });
  xr('set-transform', { device: 'headset', position: HEAD, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  hook('setLateWallSeconds', 90);
}

cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1','agentwall.wall.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
await enterXr();
hook('resetDemo');
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 2);

// ---------- 1. Where the room's wall is (for the snap check later) ----------
hook('simulateNoPlanes', false);
hook('restart');
await sleep(3000);
const onWall = hook('placement');
const wallSpot = hook('board').position;
check('with room data the board starts on a real wall', onWall?.kind === 'wall' && hook('drag').status !== 'placed', `${onWall?.kind} at ${f2(wallSpot)}`);

// ---------- 2. The card is farther away (no table, no walls: the seat fallback) ----------
hook('simulateNoPlanes', true);
hook('forgetWall');
hook('restart');
await sleep(4500);
await hook('heard', 'Find a time for my app tester call and draft the invite');
await waitIdle();
await sleep(1500);
let desk = hook('desk');
check('no table: the card rests 62 cm ahead and 52 cm below the eyes', desk?.kind === 'lap' && Math.abs(desk.position[2] + 0.62) < 0.02 && Math.abs(desk.position[1] - 0.68) < 0.02, `${desk?.kind} at ${f2(desk.position)}`);
check('that is about 80 cm from the eyes (it was 57 cm)', fromHead(desk.position) > 0.8, `${fromHead(desk.position).toFixed(2)} m`);
check('and it is drawn a little larger (0.55 before)', desk.scale > 0.64 && desk.scale < 0.67, `scale ${desk.scale.toFixed(2)}`);
const cardRest = desk.position;
shot('drag-card-farther');

// ---------- 3. Grab the board's bar and move it ----------
const start = hook('board').position;
let grab = hook('targets')['grab:board'];
point(grab);
await sleep(400);
pinchValue(1);
await sleep(700);
check('pinching the bar starts moving the board', hook('drag').active === 'board' && /Moving the board/.test(hook('interaction').agentLine), hook('interaction').agentLine);
// Point 60 cm to the right and 15 cm higher. The pinched point stays on the ray at the distance it had,
// so it travels on a sphere round the hand: work out where that is.
const aimAt = [grab[0] + 0.6, grab[1] + 0.15, grab[2]];
const handAt = [HAND.x, HAND.y, HAND.z];
const reachNow = dist(grab, handAt);
const k = reachNow / dist(aimAt, handAt);
const want = handAt.map((h, i) => h + (aimAt[i] - h) * k - grab[i]);
point(aimAt);
await sleep(900);
const mid = hook('board').position;
const got = mid.map((v, i) => v - start[i]);
check('the board follows the hand ray: the pinched point stays under the ray', dist(got, want) < 0.08 && got[0] > 0.4, `moved ${f2(got)}, the ray moved ${f2(want)}`);
shot('drag-board-moving');
pinchValue(0);
await sleep(900);
let d = hook('drag');
const placed = hook('board');
const wantYaw = Math.atan2(HEAD.x - placed.position[0], HEAD.z - placed.position[2]);
check('let go: it stays there, turned to face you, and says where it is', d.active === null && d.count === 1 && d.status === 'placed' && dist(placed.position, mid) < 0.05 && Math.abs(placed.yaw - wantYaw) < 0.06, `${d.status} yaw ${placed.yaw.toFixed(2)} want ${wantYaw.toFixed(2)} | ${hook('interaction').agentLine}`);
await sleep(1500);
check('it does not drift back afterwards', dist(hook('board').position, placed.position) < 0.01);

// ---------- 4. Push your hand away: the board goes farther ----------
grab = hook('targets')['grab:board'];
point(grab);
await sleep(400);
pinchValue(1);
await sleep(700);
const near = fromHead(hook('board').position);
// The same aim from a hand 15 cm farther from the body.
const reach = { x: HAND.x, y: HAND.y, z: HAND.z - 0.15 };
const aim = [reach.x + (grab[0] - HAND.x), reach.y + (grab[1] - HAND.y), reach.z + (grab[2] - HAND.z)];
point(aim, reach);
await sleep(900);
const far = fromHead(hook('board').position);
check('15 cm of hand sends the board well away (push to put it far)', far - near > 0.5 && far < 4.2, `${near.toFixed(2)} m -> ${far.toFixed(2)} m`);
pinchValue(0);
await sleep(900);
check('a far board is drawn larger so it stays readable', hook('view').scale > 1.01 || far < 1.8, `scale ${hook('view').scale.toFixed(2)} at ${far.toFixed(2)} m`);

// ---------- 5. Let it go near a real wall: it snaps on ----------
hook('simulateNoPlanes', false);
grab = hook('targets')['grab:board'];
point(grab);
await sleep(400);
pinchValue(1);
await sleep(700);
// Aim at the wall spot from step 1 (a little higher: the bar sits on top of the board) and push until near it.
const wallAim = [wallSpot[0], wallSpot[1] + 0.5, wallSpot[2]];
let hand = { ...HAND };
point(wallAim, hand);
await sleep(700);
for (let i = 0; i < 14; i++) {
  const now = hook('board').position;
  const gap = Math.abs(now[2] - wallSpot[2]);
  if (gap < 0.2) break;
  hand = { ...hand, z: hand.z + (now[2] > wallSpot[2] ? -0.02 : 0.02) };
  point(wallAim, hand);
  await sleep(500);
}
const before = hook('board').position;
pinchValue(0);
await sleep(1200);
d = hook('drag');
const snapped = hook('board');
check('let go within reach of the wall: it snaps onto the wall', d.status === 'wall' && Math.abs(snapped.position[2] - wallSpot[2]) < 0.03 && /on your wall/.test(hook('interaction').agentLine), `${f2(before)} -> ${f2(snapped.position)} (wall z ${wallSpot[2].toFixed(2)}) | ${hook('interaction').agentLine}`);
check('and that wall spot is remembered for next time', hook('wallMemory') !== null);
shot('drag-board-snapped');

// ---------- 6. Grab the card's bar and move the card ----------
desk = hook('desk');
let cardGrab = hook('targets')['grab:card'];
point(cardGrab);
await sleep(400);
pinchValue(1);
await sleep(700);
check('pinching the card\'s bar starts moving the card', hook('drag').active === 'card', hook('interaction').agentLine);
point([cardGrab[0] - 0.3, cardGrab[1] + 0.2, cardGrab[2]]);
await sleep(900);
check('moving a card is not a hold: the ring never starts', hook('interaction').hold === 0 && hook('plan').approval === 'needs');
pinchValue(0);
await sleep(900);
const moved = hook('desk');
check('the card stays where you put it', moved.kind === 'placed' && hook('drag').cardPlacedByYou === true && Math.abs(moved.position[0] - cardRest[0] + 0.3) < 0.15 && moved.position[1] > cardRest[1] + 0.1, `${f2(cardRest)} -> ${f2(moved.position)}`);
check('nothing was approved by dragging', hook('outbox').length === 0 && hook('plan').approval === 'needs');
shot('drag-card-placed');

// ---------- 7. Holding the bar still approves nothing and moves nothing; holding the card still approves ----------
cardGrab = hook('targets')['grab:card'];
point(cardGrab);
await sleep(400);
pinchValue(1);
await sleep(2200);
pinchValue(0);
await sleep(600);
check('a long pinch on the bar is not an approval', hook('outbox').length === 0 && hook('plan').approval === 'needs' && hook('interaction').peakHold === 0, `peak ${hook('interaction').peakHold}`);
check('and a pinch that does not move leaves the card exactly where it was', dist(hook('desk').position, moved.position) < 0.005 && /move your hand/.test(hook('interaction').agentLine), `${f2(hook('desk').position)} | ${hook('interaction').agentLine}`);
const boardBefore = hook('board');
point(hook('targets')['grab:board']);
await sleep(400);
pinchValue(1);
await sleep(900);
pinchValue(0);
await sleep(600);
check('the same for the board: it stays on its wall', dist(hook('board').position, boardBefore.position) < 0.005 && hook('drag').status === 'wall', `${hook('drag').status}`);
point(hook('targets').invite);
await sleep(400);
pinchValue(1);
await sleep(1900);
pinchValue(0);
await sleep(600);
check('pinch and hold on the card itself still approves', hook('plan').approval === 'approved' && hook('outbox').length === 1, `${hook('plan').approval} outbox ${hook('outbox').length}`);
for (let i = 0; i < 20 && hook('flow').sendingLeft !== null; i++) await sleep(1000);

// ---------- 8. The next card flies to the place you chose ----------
hook('resetDemo');
await hook('heard', 'Find a time for my app tester call and draft the invite');
await waitIdle();
await sleep(1500);
const again = hook('desk');
check('a new card lands where you put the last one', again.kind === 'placed' && dist(again.position, moved.position) < 0.02, `${again.kind} at ${f2(again.position)}`);

// ---------- 9. Leaving mixed reality starts over ----------
try { xr('exit'); } catch (e) { console.log('      exit:', e.message.slice(0, 120)); }
await sleep(1500);
check('back on the page the hand-placed card is forgotten (the coordinates changed)', hook('drag').cardPlacedByYou === false && hook('desk').kind === 'lap', `${hook('desk').kind}`);

hook('resetDemo');
hook('forgetWall');
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
