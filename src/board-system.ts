/**
 * Agent Wall's main system. "The wall thinks, the desk decides, the agent keeps watch."
 *
 * - Places the board on a detected wall (or 1.2 m in front of the user), and the
 *   invite card on the user's real table (or above their lap).
 * - Asking: pinch a preset chip, or pinch 🎤 Speak and talk. Known phrases set
 *   the rule; the AI (via our Worker) picks the time and writes the email. If it
 *   is slow (>3 s), offline or wrong, the rules plan instead and the board says so.
 * - The week mural shows the agent striking out every time it can't use, with reasons.
 * - Changing: pinch a runner-up pill on the mural to use that time.
 * - Approving: pinch and hold the desk card 1 s -> 5 s "Sending… pinch to Unsend"
 *   -> demo outbox with a receipt (RULES / AI / YOU).
 * - Keeping watch: once, after the first send, a labelled SAMPLE change lands on
 *   the approved time; the agent flags the conflict and offers to re-plan
 *   (which always needs a fresh hold).
 * - Saving: the plan and outbox are kept in localStorage.
 *
 * Decisions live in ./logic (plain TS, unit-tested). Pinch input comes from
 * IWSDK RayInteractable: a hand ray (or the mouse in the
 * desktop preview) adds Hovered; pinching adds Pressed.
 */
import {
  createSystem,
  Euler,
  Hovered,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { Board, INVITE } from './board.js';
import { CHIPS } from './chips.js';
import calendarJson from './data/sample-calendar.json';
import { runAgent, type AgentResult, type FetchLike } from './logic/agent.js';
import { chooseDesk, type DeskPlacement } from './logic/desk.js';
import { HOLD, HoldToApprove } from './logic/hold.js';
import { PlacementController } from './logic/placement-controller.js';
import { fallbackPlacement, isWallLabel, type PlaneInput, type Placement } from './logic/placement.js';
import { parsePrint, SAME_WALL, serializePrint, wallPrint, type WallPrint } from './logic/same-wall.js';
import {
  addToOutbox,
  approve,
  buildReceipt,
  chooseSlot,
  DEMO_TASK,
  isLinked,
  makePlan,
  removeFromOutbox,
  unapprove,
  UNSEND_SECONDS,
  type OutboxItem,
  type Plan,
} from './logic/plan.js';
import { parseRequest, ruleText } from './logic/request.js';
import { clock, dayLabel, type CalendarData } from './logic/scheduler.js';
import { restore, serialize, STORAGE_KEY } from './logic/storage.js';
import { sampleChange, stillFree, WATCH_DELAY_SECONDS, withGuestBusy } from './logic/watch.js';
import { tradeOff, weekModel, type WeekModel } from './logic/week.js';
import { muralAction, withoutRule, type MuralAction } from './logic/touch-week.js';
import { playApproved, playTick, unlockAudio } from './ui/sound.js';
import type { InviteExtras } from './ui/cards.js';
import { VoiceInput } from './voice.js';

const baseCalendar = calendarJson as CalendarData;
/** The Worker URL is set at build time (GitHub Actions variable). Empty = rules only. */
const AGENT_URL: string = String(import.meta.env.VITE_AGENT_URL ?? '').trim();
const MODEL_LABEL = 'Groq';
/** Each chip's rule, parsed once (not every frame). */
const CHIP_RULES = CHIPS.map((c) => parseRequest(c.say, baseCalendar).rule);

/** An Object3D as IWSDK's pointer system (@pmndrs/pointer-events) sees it. */
interface PointerHit {
  pointerId: number;
  pointerType: string;
  /** Where on the mesh's texture the ray hit (0..1). */
  uv?: { x: number; y: number };
}

interface PointerTarget {
  addEventListener(type: 'pointerdown' | 'pointermove' | 'pointerleave', listener: (e: PointerHit) => void): void;
  setPointerCapture(pointerId: number): void;
}

/**
 * Capture the pointer for the length of a pinch. IWSDK 1.0.1 (MultiPointer,
 * processButtonLifecycle) drops the release when the ray ends on empty space:
 * the hand stays "selecting" and the NEXT pinch is swallowed as the release.
 * That happened every time a pinched "Also free" row moved under the ray, and
 * whenever a hold was released while pointing away. A captured ray keeps its hit,
 * so the release always arrives, and up() frees the capture again.
 * Never for the fingertip (touch) pointer: it only lets go when it loses its hit,
 * which a capture prevents, so it would own the hand for good.
 */
function capture(target: PointerTarget, e: PointerHit): void {
  if (e.pointerType !== 'touch') target.setPointerCapture(e.pointerId);
}

interface NativePlane {
  orientation?: 'horizontal' | 'vertical';
  semanticLabel?: string;
  polygon: ReadonlyArray<{ x: number; z: number }>;
}

type Press =
  | { kind: 'chip' | 'alt' | 'replan'; index: number }
  | { kind: 'invite' | 'move'; index: 0 }
  | { kind: 'mural'; index: 0; u: number; v: number };

/** Seconds to look at the new spot after pinching "Move board". */
export const MOVE_SECONDS = 3;

type PlacementRequest = { useMemory: boolean; anyAngle?: boolean; why?: 'move' | 'recenter' };

export interface AgentWallDebug {
  state: () => string;
  placement: () => Placement | null;
  board: () => { position: number[]; yaw: number; visible: boolean };
  planes: () => Array<{ id: number; vertical: boolean; label?: string; position: number[] }>;
  restart: () => void;
  /** Test hook: pretend the device reports no planes (like a Quest without Space Setup). */
  simulateNoPlanes: (on: boolean) => void;
  /** The remembered wall fingerprint (same spot next session), or null. */
  wallMemory: () => WallPrint | null;
  forgetWall: () => void;
  plan: () => (Plan & { linked: boolean }) | null;
  cards: () => Array<{ name: string; visible: boolean }>;
  /** World positions of the pinchable targets, for aiming in the emulator. */
  targets: () => Record<string, number[]>;
  interaction: () => {
    hold: number;
    inviteHovered: boolean;
    invitePressed: boolean;
    altHovered: number | null;
    chipHovered: number | null;
    presses: number;
    inviteHeld: boolean;
    boardVisible: boolean;
    peakHold: number;
    busy: boolean;
    agentLine: string;
    lastAskMs: number;
  };
  outbox: () => OutboxItem[];
  /** Where the invite card went: the real table or the lap spot. */
  desk: () => { kind: string; position: number[]; visible: boolean } | null;
  /** The week mural: sweep still playing? how many half hours ruled out? */
  mural: () => { visible: boolean; sweeping: boolean; ruledOut: number; fresh: number };
  /** Unsend window and conflict state. */
  flow: () => { sendingLeft: number | null; conflict: string | null; replan: boolean; watchFired: boolean; clock: number; moving: boolean };
  /** Test hook: fire the agent's sample change now (instead of 8 s after the first send). */
  watchNow: () => void;
  /** Same path as Quest's recenter (XRReferenceSpace 'reset'). */
  recenter: () => void;
  muralPoint: (dayIndex: number, minute: number) => [number, number, number] | null;
  weekCells: () => Array<{ day: string; start: number; kind: string; reason: string }>;
  setMoveSeconds: (seconds: number) => void;
  setFlySlowdown: (k: number) => void;
  /** Test hook: turn the automatic sample change on/off (off keeps long test runs predictable). */
  setWatch: (on: boolean) => void;
  /** Test hook: what the mic would have heard (the emulator has no microphone). */
  heard: (text: string) => Promise<void>;
  /** Test hook: point the agent at a fake AI: an answer object, 'offline', or null to undo. */
  fakeAi: (answer: unknown, delayMs?: number) => void;
  /** Test hook: make the hold longer so a screenshot can catch the ring mid-fill. */
  setHoldSeconds: (seconds: number) => void;
  /** Test hook: a longer Unsend window (emulator commands take ~1 s each). */
  setUnsendSeconds: (seconds: number) => void;
  /** Test hook: clear the outbox, the plan and the saved board. */
  resetDemo: () => void;
  /** Test hook: the saved JSON, as reopening the app would read it. */
  saved: () => string | null;
}

declare global {
  interface Window {
    agentwall?: AgentWallDebug;
  }
}

function readStorage(key: string = STORAGE_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(json: string | null, key: string = STORAGE_KEY): void {
  try {
    if (json === null) localStorage.removeItem(key);
    else localStorage.setItem(key, json);
  } catch {
    // Private mode or storage blocked: the board still works, it just won't be remembered.
  }
}

function savedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const nowLabel = () => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const shortWhen = (day: string, min: number) => `${dayLabel(day).short.split(' ')[0]} ${clock(min)}`;

export class BoardSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private board!: Board;
  private controller = new PlacementController();
  /** The wall the board was on last time (same spot next session); kept apart from the plan. */
  private wallMemory: WallPrint | null = parsePrint(readStorage(SAME_WALL.storageKey));
  private pendingStart = false;
  private pendingRequest: PlacementRequest = { useMemory: true };
  /** The placement in progress was asked for by Move or a recenter (for the status line). */
  private placingFor: PlacementRequest['why'] | null = null;
  /** "Move board": countdown end, in app seconds. */
  private moveUntil: number | null = null;
  private moveSeconds = MOVE_SECONDS;
  /** Headset recentered: re-place the board at this time (planes need a moment to update). */
  private recenterAt: number | null = null;
  private resetSpace: XRReferenceSpace | null = null;
  private moveEntity!: Entity;
  private backEntity!: Entity;
  /** Where the hand ray is on the week (texture uv), for the hover highlight. */
  private muralUv: { u: number; v: number } | null = null;
  private muralUvKey = '';
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private headFwd = new Vector3();
  private tmp = new Vector3();
  private lastPlanes: PlaneInput[] = [];
  private noPlanes = false;
  private cal: CalendarData = baseCalendar;
  private plan: Plan | null = null;
  private outbox: OutboxItem[] = [];
  private week: WeekModel | null = null;
  private weekKey = '';
  private tradeOffText: { plan: Plan | null; text: string | null } = { plan: null, text: null };
  private hold = new HoldToApprove();
  private inviteEntity!: Entity;
  private altEntities: Entity[] = [];
  private chipEntities: Entity[] = [];
  private replanEntities: Entity[] = [];
  private presses: Press[] = [];
  /** Total presses received (debug/test hook). */
  private pressCount = 0;
  private holdPlanVersion = -1;
  private peakHold = 0;
  private busy = false;
  private requestId = 0;
  private agentLineText = '';
  private lastAskMs = 0;
  private voice!: VoiceInput;
  private agentUrl = AGENT_URL;
  private fetchImpl: FetchLike | undefined;
  private animateNext = true;
  /** Seconds since start (render clock), for the Unsend window and the watch timer. */
  private clockS = 0;
  private currentItemId: string | null = null;
  private sendingUntil: number | null = null;
  private watchEnabled = true;
  private watchAt: number | null = null;
  private watchFired = false;
  private conflict: string | null = null;
  private replanText: string | null = null;
  private fresh = new Set<string>();
  private deskPlace: DeskPlacement | null = null;
  /** A pinch that started on the invite and has not been released yet. */
  private inviteHeld = false;
  private releaseHold: () => void = () => {};
  private unsendSeconds = UNSEND_SECONDS;

  init(): void {
    this.board = new Board();
    const boardEntity = this.world.createTransformEntity(this.board.object);
    const deskEntity = this.world.createTransformEntity(this.board.desk);
    const interactive = (mesh: Parameters<typeof this.world.createTransformEntity>[0], parent: Entity) => {
      const e = this.world.createTransformEntity(mesh, { parent });
      e.addComponent(RayInteractable);
      return e;
    };
    this.inviteEntity = interactive(this.board.inviteCard.mesh, deskEntity);
    // Pinch only, no finger poke: IWSDK gives the touch pointer priority over the ray
    // whenever a fingertip is within 15 cm of a pokeable object, and this card sits
    // where hands rest, so a poke target here would block pinching the wall chips.
    this.altEntities = this.board.altRows.map((row) => interactive(row.mesh, boardEntity));
    this.chipEntities = this.board.chipPanels.map((chip) => interactive(chip.mesh, boardEntity));
    this.replanEntities = this.board.replanButtons.map((b) => interactive(b.mesh, boardEntity));
    this.moveEntity = interactive(this.board.moveButton.mesh, boardEntity);
    // The board itself is a (do-nothing) ray target: IWSDK only shows the hand ray's
    // cursor on targets, and the first Quest tester saw no pointer until exactly on a chip.
    this.backEntity = interactive(this.board.backPanel.mesh, boardEntity);
    // The week itself is touchable: pick a free time, remove a rule, or ask why.
    interactive(this.board.mural.mesh, boardEntity);

    // IWSDK's pointer system dispatches pointer events on the Object3D itself.
    // A fast click can press and release between two frames, so presses are
    // collected from pointerdown events instead of polling the Pressed tag.
    const onPress = (mesh: unknown, press: Press) => {
      const target = mesh as PointerTarget;
      target.addEventListener('pointerdown', (e) => {
        capture(target, e);
        this.presses.push(press);
      });
    };
    this.board.chipPanels.forEach((chip, i) => onPress(chip.mesh, { kind: 'chip', index: i }));
    this.board.altRows.forEach((row, i) => onPress(row.mesh, { kind: 'alt', index: i }));
    this.board.replanButtons.forEach((b, i) => onPress(b.mesh, { kind: 'replan', index: i }));
    onPress(this.board.moveButton.mesh, { kind: 'move', index: 0 });
    // A pinch on the bare board does nothing, but it still captures the ray so the
    // release always arrives (see capture()).
    const back = this.board.backPanel.mesh as unknown as PointerTarget;
    back.addEventListener('pointerdown', (e) => capture(back, e));
    const mural = this.board.mural.mesh as unknown as PointerTarget;
    mural.addEventListener('pointerdown', (e) => {
      capture(mural, e);
      if (e.uv) this.presses.push({ kind: 'mural', index: 0, u: e.uv.x, v: e.uv.y });
    });
    mural.addEventListener('pointermove', (e) => {
      if (e.uv) this.muralUv = { u: e.uv.x, v: e.uv.y };
    });
    mural.addEventListener('pointerleave', () => {
      this.muralUv = null;
    });
    // Pinch-and-hold: a pinch that STARTS on the invite keeps holding until the hand
    // opens (XR selectend, or mouse-up), even if the ray drifts off the card.
    // The ray capture above already keeps the hit on the card; inviteHeld is a second,
    // simpler guarantee that also covers the desktop mouse.
    const invite = this.board.inviteCard.mesh as unknown as PointerTarget;
    invite.addEventListener('pointerdown', (e) => {
      capture(invite, e);
      this.inviteHeld = true;
      this.presses.push({ kind: 'invite', index: 0 });
    });
    const release = () => {
      this.inviteHeld = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    });
    this.releaseHold = release;

    this.voice = new VoiceInput(
      this.agentUrl,
      (text) => void this.ask(text, `Heard: “${text}”`),
      (message) => this.say(message, 'warn'),
      () => this.drawChips(),
    );

    // Yesterday's board, if there is one.
    const saved = restore(readStorage(), baseCalendar);
    if (saved) {
      // An invite that was mid-Unsend when the app closed counts as sent.
      this.outbox = saved.outbox.map((o) => (o.status === 'sending' ? { ...o, status: 'sent' as const } : o));
      if (saved.plan) {
        this.animateNext = false;
        this.setPlan(saved.plan, false);
        if (saved.plan.approval === 'approved') {
          this.currentItemId = this.outbox.find((o) => o.slotId === saved.plan?.slot?.id)?.id ?? null;
        }
      }
      this.say(`Welcome back · board saved ${savedLabel(saved.savedAt)}`, 'ok');
    } else if (!this.agentUrl) {
      this.say('Rules mode (AI not connected)', 'muted');
    }
    this.board.setOutbox(this.outbox);

    // A judge may enter through Quest Browser's own Enter button, which never clicks our
    // page, so sound would stay locked. XR select (pinch) events count as a user
    // gesture: unlock audio on the first pinch of each session.
    const onSessionStart = () => {
      const session = this.xrManager.getSession();
      session?.addEventListener('selectstart', unlockAudio, { once: true });
      // The hand opened (or tracking ended): the invite hold stops.
      session?.addEventListener('selectend', () => this.releaseHold());
      session?.addEventListener('end', () => {
        this.releaseHold();
        this.detachReset();
      });
    };
    this.xrManager.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onSessionStart));

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.NonImmersive) {
          this.controller.stop();
          this.pendingStart = false;
          this.showDesktopPreview();
        } else if (this.controller.state === 'idle') {
          this.pendingStart = true;
          this.board.object.visible = false;
          this.board.desk.visible = false;
          this.board.setStatus('searching');
        }
      }),
    );

    this.installDebugHooks();
  }

  update(delta: number, time: number): void {
    this.clockS = time;
    this.attachReset();
    this.voice.tick();
    this.updateInteraction(delta);
    this.updateTimers();
    this.drawChips();
    this.renderBoard();
    this.board.tick(delta, time);
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    this.updatePlacement(time);
  }

  /**
   * Quest's recenter moves the session's coordinate origin, so the board (fixed in
   * those coordinates) jumped "to the right side of me" in the first real test.
   * The room did not move: put the board back on its remembered spot.
   */
  private readonly onReset = () => {
    this.recenterAt = this.clockS + 0.4;
  };

  private attachReset(): void {
    if (this.resetSpace || !this.xrManager.isPresenting) return;
    const space = this.xrManager.getReferenceSpace();
    if (!space) return;
    space.addEventListener('reset', this.onReset);
    this.resetSpace = space;
  }

  private detachReset(): void {
    this.resetSpace?.removeEventListener('reset', this.onReset);
    this.resetSpace = null;
    this.recenterAt = null;
  }

  /** Re-run placement (Move board, recenter, restart). */
  private requestPlacement(req: PlacementRequest): void {
    this.pendingRequest = req;
    this.pendingStart = true;
    this.placingFor = req.why ?? null;
  }

  private say(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok'): void {
    this.agentLineText = text;
    this.board.setAgentLine(text, tone);
  }

  // ---------- drawing state ----------

  private currentWeek(): WeekModel | null {
    if (!this.plan) return null;
    const key = JSON.stringify([this.plan.constraint, this.cal.busy.guest.length]);
    if (key !== this.weekKey) {
      this.weekKey = key;
      this.week = weekModel(this.cal, this.plan.constraint);
    }
    return this.week;
  }

  private inviteExtras(): InviteExtras {
    const plan = this.plan;
    if (plan && plan !== this.tradeOffText.plan) {
      this.tradeOffText = {
        plan,
        text: plan.slot ? tradeOff(this.cal, plan.slot, plan.constraint) : null,
      };
    }
    const item = this.currentItemId ? this.outbox.find((o) => o.id === this.currentItemId) : undefined;
    return {
      tradeOff: this.tradeOffText.text,
      sendingLeft:
        this.sendingUntil !== null ? Math.max(1, Math.ceil(this.sendingUntil - this.clockS)) : null,
      receipt: item?.status !== 'sending' ? (item?.receipt ?? null) : null,
      conflict: this.conflict,
    };
  }

  private renderBoard(): void {
    this.board.render(
      {
        plan: this.plan,
        week: this.currentWeek(),
        invite: this.inviteExtras(),
        replanText: this.replanText,
        fresh: this.fresh,
      },
      this.animateNext,
    );
    if (this.plan) this.animateNext = true;
  }

  // ---------- asking the agent ----------

  /** Chips, voice, re-plan and test hooks all come through here. */
  private async ask(text: string, heard = ''): Promise<AgentResult | null> {
    const id = ++this.requestId;
    this.busy = true;
    this.say(heard ? `${heard} · thinking…` : 'Thinking…', 'ai');
    const t0 = performance.now();
    let result: AgentResult;
    try {
      result = await runAgent(this.cal, text, this.plan, { url: this.agentUrl, fetch: this.fetchImpl });
    } finally {
      if (id === this.requestId) this.busy = false;
    }
    if (id !== this.requestId) return null; // a newer request won
    this.lastAskMs = performance.now() - t0;
    // Result first, then what was heard: the line is trimmed from the end when long,
    // so the attribution must never be the part that gets cut.
    const post = heard ? ` · ${heard}` : '';
    if (!result.plan) {
      this.say(heard ? `Not sure what you meant; try a chip · ${heard}` : 'Not sure what you meant', 'warn');
      return result;
    }
    this.setPlan(result.plan);
    playTick();
    if (result.by === 'ai' && !result.note) this.say(`Planned by AI · ${MODEL_LABEL}${post}`, 'ai');
    else if (result.by === 'ai') {
      // Short, calm wording: the rules double-checking the AI is a feature, not an error.
      const fixed = /did not fit/.test(result.note) ? 'rules corrected the time' : 'email from template';
      this.say(`Planned by AI · ${fixed}${post}`, 'ai');
    } else this.say(`${result.note ? `Rules · ${result.note.replace(/; rules planned this$/, '')}` : 'Planned by rules'}${post}`, 'warn');
    return result;
  }

  // ---------- pinches ----------

  private hoveredIndex(list: Entity[]): number | null {
    const i = list.findIndex((e) => e.hasComponent(Hovered));
    return i < 0 ? null : i;
  }

  private updateInteraction(delta: number): void {
    const live = this.board.object.visible;

    for (const press of this.presses.splice(0)) {
      this.pressCount++;
      if (!live) continue;
      this.controller.lock(); // the user is using the board: no more jumping
      if (press.kind === 'chip') {
        const chip = CHIPS[press.index];
        if (chip.id === 'mic') void this.voice.toggle();
        else if (!this.busy) void this.ask(chip.say);
      } else if (press.kind === 'alt') {
        const plan = this.plan;
        const alt = plan?.alternatives[press.index];
        if (plan && alt && !this.busy) {
          this.animateNext = false; // your own pick: no need to replay the agent's sweep
          this.setPlan(chooseSlot(this.cal, plan, alt));
          this.say('You picked this time', 'muted');
          playTick();
        }
      } else if (press.kind === 'replan') {
        if (this.replanText === null || this.busy) continue;
        if (press.index === 0) void this.replan();
        else {
          this.replanText = null;
          this.say('Okay · the conflict stays flagged on the card', 'muted');
        }
      } else if (press.kind === 'invite' && this.sendingUntil !== null) {
        this.unsend();
      } else if (press.kind === 'mural') {
        this.pressMural(press.u, press.v);
      } else if (press.kind === 'move' && this.world.visibilityState.value === VisibilityState.NonImmersive) {
        this.say('Move board works in mixed reality: it moves the board to the wall you look at', 'muted');
      } else if (press.kind === 'move' && this.moveUntil === null) {
        this.moveUntil = this.clockS + this.moveSeconds;
        this.say('Look at the spot on your wall where you want the board', 'ai');
        playTick();
      }
    }

    // Invite: pinch and hold to approve.
    const current = this.plan;
    if (current && current.version !== this.holdPlanVersion) {
      this.hold.reset(); // the invite changed under the user's fingers
      this.holdPlanVersion = current.version;
    }
    const canApprove =
      live && !this.busy && !this.board.sweeping && current?.invite != null && current.approval === 'needs';
    const pressed = this.inviteHeld || this.inviteEntity.hasComponent(Pressed);
    if (!this.board.desk.visible) this.inviteHeld = false;
    if (pressed) this.controller.lock();
    const event = this.hold.update(delta, pressed, canApprove);
    if (event === 'complete' && current) this.approveNow(current);
    this.peakHold = Math.max(this.peakHold, this.hold.progress);
    this.board.setHold(this.hold.progress);
    this.board.setHover(
      canApprove && this.inviteEntity.hasComponent(Hovered),
      this.hoveredIndex(this.altEntities),
      this.hoveredIndex(this.replanEntities),
    );
    this.updateMuralHover();
    const moveLeft = this.moveUntil === null ? 0 : Math.max(1, Math.ceil(this.moveUntil - this.clockS));
    this.board.setMove(
      this.moveUntil === null ? '⤢ Move board' : `Look at a wall · ${moveLeft}`,
      this.moveUntil === null && this.moveEntity.hasComponent(Hovered),
    );
  }

  /** What pinching this spot of the week would do (null outside it, or while busy). */
  private muralActionAt(u: number, v: number): MuralAction | null {
    if (this.busy || this.board.sweeping || !this.plan) return null;
    const spot = this.board.muralSpot(u, v);
    const week = this.currentWeek();
    if (!spot || !week) return null;
    return muralAction(this.cal, this.plan, week, spot.dayIndex, spot.minute);
  }

  private pressMural(u: number, v: number): void {
    const action = this.muralActionAt(u, v);
    const plan = this.plan;
    if (!action || !plan) return;
    if (action.kind === 'pick') {
      if (plan.slot?.id === action.slot.id) return;
      this.animateNext = false; // your own pick: no need to replay the agent's sweep
      this.setPlan(chooseSlot(this.cal, plan, action.slot));
      this.say(`You picked ${shortWhen(action.slot.day, action.slot.start)}`, 'muted');
      playTick();
    } else if (action.kind === 'remove-rule') {
      const next = withoutRule(plan.constraint, action.key);
      this.setPlan(makePlan(this.cal, next, ruleText(next), plan));
      this.say(`Removed your rule "${action.label}" · the agent re-planned`, 'ok');
      playTick();
    } else {
      this.say(action.text, 'muted');
    }
  }

  /** Light up the free time or the rule under the hand ray (redraws only on change). */
  private updateMuralHover(): void {
    const uv = this.muralUv;
    const key = uv ? `${uv.u.toFixed(3)},${uv.v.toFixed(3)}|${this.plan?.version ?? 0}|${this.board.sweeping}` : '';
    if (key === this.muralUvKey) return;
    this.muralUvKey = key;
    const action = uv ? this.muralActionAt(uv.u, uv.v) : null;
    if (!action || action.kind === 'explain') {
      this.board.setMuralHover(null);
    } else if (action.kind === 'pick') {
      const current = this.plan?.slot?.id === action.slot.id;
      this.board.setMuralHover({
        kind: 'pick',
        day: action.cell.day,
        start: action.cell.start,
        reason: action.cell.reason,
        label: current ? 'Chosen time' : `Pinch: ${clock(action.slot.start)}`,
      });
    } else {
      this.board.setMuralHover({
        kind: 'rule',
        day: action.cell.day,
        start: action.cell.start,
        reason: action.cell.reason,
        label: `Pinch to remove: ${action.label}`,
      });
    }
  }

  private approveNow(current: Plan): void {
    const result = approve(current, new Date().toISOString());
    if (!result) return;
    const item: OutboxItem = { ...result.item, status: 'sending' };
    this.outbox = addToOutbox(this.outbox, item);
    this.currentItemId = item.id;
    this.sendingUntil = this.clockS + this.unsendSeconds;
    this.conflict = null;
    this.setPlan(result.plan);
    this.holdPlanVersion = result.plan.version;
    this.board.setOutbox(this.outbox);
    this.board.celebrate();
    this.say(`Approved · sending in ${UNSEND_SECONDS} s · pinch the card to Unsend`, 'ok');
    playApproved();
  }

  /** Pull the invite back inside the Unsend window. */
  private unsend(): void {
    if (!this.plan || this.currentItemId === null) return;
    this.outbox = removeFromOutbox(this.outbox, this.currentItemId);
    this.currentItemId = null;
    this.sendingUntil = null;
    this.hold.requireRelease(); // the pinch that pressed Unsend must not start a new hold
    this.setPlan(unapprove(this.plan));
    this.board.setOutbox(this.outbox);
    this.say('Unsent · nothing left · the invite needs your hold again', 'warn');
    playTick();
  }

  private updateTimers(): void {
    if (this.moveUntil !== null && this.clockS >= this.moveUntil) {
      this.moveUntil = null;
      this.requestPlacement({ useMemory: false, why: 'move' }); // where the user looks now
    }
    if (this.recenterAt !== null && this.clockS >= this.recenterAt) {
      this.recenterAt = null;
      if (this.board.object.visible) this.requestPlacement({ useMemory: true, anyAngle: true, why: 'recenter' });
    }
    // Unsend window over: the invite lands in the demo outbox with its receipt.
    if (this.sendingUntil !== null && this.clockS >= this.sendingUntil && this.plan && this.currentItemId) {
      const week = this.currentWeek();
      const receipt = buildReceipt(this.cal, this.plan, week?.ruledOut ?? 0, nowLabel());
      this.outbox = this.outbox.map((o) => (o.id === this.currentItemId ? { ...o, status: 'sent' as const, receipt } : o));
      this.sendingUntil = null;
      this.board.setOutbox(this.outbox);
      this.save();
      this.say('In the demo outbox · nothing was really sent', 'ok');
      playTick();
      if (this.watchEnabled && !this.watchFired && this.watchAt === null) {
        this.watchAt = this.clockS + WATCH_DELAY_SECONDS;
      }
    }
    // The agent keeps watch: the sample change lands once.
    if (this.watchAt !== null && this.clockS >= this.watchAt) {
      this.watchAt = null;
      this.fireWatch();
    }
  }

  /** The labelled SAMPLE change lands on the approved time; the agent flags it. */
  private fireWatch(): void {
    const plan = this.plan;
    if (this.watchFired || !plan?.slot || plan.approval !== 'approved') return;
    this.watchFired = true;
    const slot = plan.slot;
    this.cal = withGuestBusy(this.cal, sampleChange(slot));
    if (stillFree(this.cal, slot)) return;
    this.fresh = new Set([...this.fresh, `${slot.day}T${slot.start}`]);
    const when = shortWhen(slot.day, slot.start);
    this.conflict = `Conflict: ${this.cal.guest.name} is now busy ${when}`;
    this.replanText = `${this.cal.guest.name} just added a dentist visit (SAMPLE change) at ${when}. Your approved invite no longer fits.`;
    this.say('Agent noticed a conflict · re-plan?', 'warn');
    playTick();
  }

  /** Re-plan after a conflict: same rule, new time; always needs a fresh hold. */
  private async replan(): Promise<void> {
    this.replanText = null;
    const before = this.plan?.slot;
    const result = await this.ask(DEMO_TASK);
    if (result?.plan?.slot) {
      this.conflict = null;
      const moved = shortWhen(result.plan.slot.day, result.plan.slot.start);
      const from = before ? ` from ${shortWhen(before.day, before.start)}` : '';
      this.say(`Re-planned${from} to ${moved} · needs your hold`, 'ai');
    }
  }

  private drawChips(): void {
    if (!this.board) return;
    const hovered = this.hoveredIndex(this.chipEntities);
    const c = this.plan?.constraint ?? {};
    CHIPS.forEach((chip, i) => {
      if (chip.id === 'mic') {
        if (this.voice.state === 'listening') this.board.setChip(i, 'listening', `● Listening ${this.voice.remaining}`);
        else if (this.voice.state === 'transcribing') this.board.setChip(i, 'busy', 'Hearing…');
        else if (this.voice.state === 'starting') this.board.setChip(i, 'busy', 'Mic…');
        else if (!this.voice.available) this.board.setChip(i, 'disabled');
        else this.board.setChip(i, hovered === i ? 'hover' : 'normal');
        return;
      }
      const rule = CHIP_RULES[i];
      const on =
        (chip.id === 'after4' && c.after === rule.after) ||
        (chip.id === 'thu' && c.day === rule.day) ||
        (chip.id === 'notwed' && !!c.notDays?.includes(rule.notDays?.[0] ?? '')) ||
        (chip.id === 'task' && this.plan !== null);
      const look = this.busy ? 'disabled' : hovered === i ? 'hover' : on ? 'active' : 'normal';
      this.board.setChip(i, look);
    });
  }

  // ---------- plan + saving ----------

  private setPlan(plan: Plan | null, save = true): void {
    // Any change to an invite that is still in its Unsend window cancels the send.
    if (this.sendingUntil !== null && this.currentItemId && plan?.approval !== 'approved') {
      this.outbox = removeFromOutbox(this.outbox, this.currentItemId);
      this.sendingUntil = null;
      this.board?.setOutbox(this.outbox);
    }
    if (plan?.approval !== 'approved') this.currentItemId = null;
    this.plan = plan;
    if (save) this.save();
  }

  private save(): void {
    writeStorage(serialize(this.plan, this.outbox, new Date().toISOString()));
  }

  // ---------- placement ----------

  private updatePlacement(time: number): void {
    if (this.pendingStart) {
      this.pendingStart = false;
      const req = this.pendingRequest;
      this.pendingRequest = { useMemory: true };
      this.controller.start(time, req.useMemory ? this.wallMemory : null, { anyAngle: req.anyAngle });
    }
    if (this.controller.settled) return;
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldQuaternion(this.headQuat);
    this.headFwd.set(0, 0, -1).applyQuaternion(this.headQuat);
    if (this.headPos.lengthSq() < 1e-6) return; // no real head pose yet
    this.lastPlanes = this.collectPlanes();
    const next = this.controller.tick(time, this.headPos, this.headFwd, this.lastPlanes);
    if (next) this.apply(next);
  }

  private collectPlanes(): PlaneInput[] {
    const out: PlaneInput[] = [];
    if (this.noPlanes) return out;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as NativePlane | undefined;
      const obj = entity.object3D;
      if (!plane || !obj) continue;
      out.push({
        id: entity.index,
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        orientation: { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w },
        polygon: plane.polygon,
        vertical: plane.orientation === 'vertical',
        label: plane.semanticLabel,
      });
    }
    return out;
  }

  private apply(p: Placement): void {
    const o = this.board.object;
    o.position.set(p.position.x, p.position.y, p.position.z);
    o.rotation.set(0, p.yaw, 0);
    o.scale.setScalar(p.scale);
    o.visible = true;
    this.board.setStatus(p.remembered ? 'same-wall' : p.kind);
    if (p.kind === 'wall') this.rememberWall(p);
    const why = this.placingFor;
    this.placingFor = null;
    const immersive = this.world.visibilityState.value !== VisibilityState.NonImmersive;
    if (p.kind === 'fallback' && immersive) {
      const hasWalls = this.lastPlanes.some((q) => q.vertical && isWallLabel(q.label));
      this.say(
        hasWalls
          ? 'No wall square in front of you · floating here · pinch Move board and look at a wall'
          : 'No wall found · run Space Setup in Quest settings to pin the board to a wall',
        'warn',
      );
    } else if (why === 'move') {
      this.say('Board moved · it comes back here next time', 'ok');
    } else if (why === 'recenter') {
      if (p.remembered) this.say('Recentered · board kept on its spot', 'ok');
    } else if (p.remembered) {
      this.say('Back on your wall · same spot as last time', 'ok');
    } else if (p.kind === 'wall' && /No wall|square in front/.test(this.agentLineText)) {
      this.say('', 'muted');
    }
    // The desk decides: the invite card goes to the real table in front, or the lap.
    this.placeDesk(chooseDesk(this.headPos, this.headFwd, this.lastPlanes));
  }

  /** Save the wall's fingerprint so the next session can find the same spot. */
  private rememberWall(p: Placement): void {
    const plane = this.lastPlanes.find((q) => q.id === p.planeId);
    const print = plane ? wallPrint(this.headPos, plane, p.position) : null;
    if (!print) return;
    this.wallMemory = print;
    writeStorage(serializePrint(print), SAME_WALL.storageKey);
  }

  private placeDesk(d: DeskPlacement): void {
    this.deskPlace = d;
    this.board.setDeskPose(d.position.x, d.position.y, d.position.z, new Euler(-d.tilt, d.yaw, 0, 'YXZ'));
  }

  private showDesktopPreview(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.headPos);
    cam.getWorldDirection(this.headFwd); // cameras look down -Z; this already returns it
    const p = fallbackPlacement(this.headPos, this.headFwd);
    // Board a little left so the desk card can sit to its lower right, both in view.
    this.apply({ ...p, position: { ...p.position, x: p.position.x - 0.22 } });
    this.board.setStatus('preview');
    const pos = { x: this.headPos.x + 0.48, y: this.headPos.y - 0.26, z: this.headPos.z - 0.95 };
    const back = { x: this.headPos.x - pos.x, z: this.headPos.z - pos.z };
    this.placeDesk({ kind: 'lap', position: pos, yaw: Math.atan2(back.x, back.z), tilt: 0.2 });
  }

  // ---------- test hooks ----------

  private installDebugHooks(): void {
    const at = (o: { getWorldPosition: (v: Vector3) => Vector3 }) => o.getWorldPosition(this.tmp).toArray();
    window.agentwall = {
      state: () => this.controller.state,
      placement: () => this.controller.current,
      board: () => {
        const o = this.board.object;
        return { position: o.position.toArray(), yaw: o.rotation.y, visible: o.visible };
      },
      planes: () =>
        this.lastPlanes.map((p) => ({
          id: p.id,
          vertical: p.vertical,
          label: p.label,
          position: [p.position.x, p.position.y, p.position.z],
        })),
      restart: () => {
        this.pendingStart = true;
      },
      simulateNoPlanes: (on) => {
        this.noPlanes = on;
      },
      wallMemory: () => this.wallMemory,
      forgetWall: () => {
        this.wallMemory = null;
        writeStorage(null, SAME_WALL.storageKey);
      },
      plan: () => (this.plan ? { ...this.plan, linked: isLinked(this.plan) } : null),
      cards: () =>
        [this.board.mural, this.board.inviteCard].map((c) => ({
          name: c.mesh.name,
          visible: c.mesh.visible && (c === this.board.inviteCard ? this.board.desk.visible : this.board.object.visible),
        })),
      targets: () => {
        const t: Record<string, number[]> = {
          invite: at(this.board.inviteCard.mesh),
          alt0: at(this.board.altRows[0].mesh),
          alt1: at(this.board.altRows[1].mesh),
          'replan:yes': at(this.board.replanButtons[0].mesh),
          'replan:no': at(this.board.replanButtons[1].mesh),
          move: at(this.board.moveButton.mesh),
          mural: at(this.board.mural.mesh),
        };
        CHIPS.forEach((c, i) => (t[`chip:${c.id}`] = at(this.board.chipPanels[i].mesh)));
        return t;
      },
      interaction: () => ({
        hold: this.hold.progress,
        inviteHovered: this.inviteEntity.hasComponent(Hovered),
        invitePressed: this.inviteEntity.hasComponent(Pressed),
        altHovered: this.hoveredIndex(this.altEntities),
        chipHovered: this.hoveredIndex(this.chipEntities),
        boardHovered: this.backEntity.hasComponent(Hovered),
        replanHovered: this.hoveredIndex(this.replanEntities),
        presses: this.pressCount,
        inviteHeld: this.inviteHeld,
        boardVisible: this.board.object.visible,
        peakHold: this.peakHold,
        busy: this.busy,
        agentLine: this.agentLineText,
        lastAskMs: Math.round(this.lastAskMs),
      }),
      outbox: () => this.outbox,
      desk: () =>
        this.deskPlace
          ? {
              kind: this.deskPlace.kind,
              position: [this.deskPlace.position.x, this.deskPlace.position.y, this.deskPlace.position.z],
              visible: this.board.desk.visible,
            }
          : null,
      muralPoint: (dayIndex, minute) => this.board.muralPoint(dayIndex, minute),
      weekCells: () => this.currentWeek()?.cells ?? [],
      mural: () => ({
        hover: this.board.muralHoverLabel,
        visible: this.board.mural.mesh.visible && this.board.object.visible,
        sweeping: this.board.sweeping,
        flying: this.board.flying,
        deskNow: this.board.desk.getWorldPosition(new Vector3()).toArray(),
        ruledOut: this.week?.ruledOut ?? 0,
        fresh: this.fresh.size,
      }),
      flow: () => ({
        sendingLeft: this.sendingUntil !== null ? Math.max(0, this.sendingUntil - this.clockS) : null,
        conflict: this.conflict,
        replan: this.replanText !== null,
        watchFired: this.watchFired,
        clock: this.clockS,
        moving: this.moveUntil !== null,
      }),
      recenter: () => {
        this.onReset();
      },
      setMoveSeconds: (seconds) => {
        this.moveSeconds = seconds;
      },
      setFlySlowdown: (k) => {
        this.board.flySlowdown = k;
      },
      watchNow: () => {
        this.watchAt = null;
        this.fireWatch();
      },
      setWatch: (on) => {
        this.watchEnabled = on;
        if (!on) this.watchAt = null;
      },
      heard: async (text) => {
        await this.ask(text, `Heard: “${text}”`);
      },
      fakeAi: (answer, delayMs = 0) => {
        if (answer === null) {
          this.agentUrl = AGENT_URL;
          this.fetchImpl = undefined;
          return;
        }
        this.agentUrl = 'https://fake-ai.test';
        this.fetchImpl = (_url, init) =>
          new Promise((resolve, reject) => {
            if (answer === 'offline') {
              reject(new TypeError('Failed to fetch'));
              return;
            }
            const timer = setTimeout(() => resolve(Response.json(answer)), delayMs);
            init.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
      },
      setHoldSeconds: (seconds) => {
        this.hold = new HoldToApprove({ ...HOLD, seconds });
      },
      setUnsendSeconds: (seconds) => {
        this.unsendSeconds = seconds;
      },
      resetDemo: () => {
        this.requestId++;
        this.busy = false;
        this.peakHold = 0;
        this.outbox = [];
        this.cal = baseCalendar;
        this.conflict = null;
        this.replanText = null;
        this.fresh = new Set();
        this.sendingUntil = null;
        this.currentItemId = null;
        this.watchAt = null;
        this.watchFired = false;
        this.setPlan(null, false);
        this.board.setOutbox([]);
        this.say('', 'muted');
        writeStorage(null);
        this.wallMemory = null;
        writeStorage(null, SAME_WALL.storageKey);
      },
      saved: () => readStorage(),
    };
  }
}

