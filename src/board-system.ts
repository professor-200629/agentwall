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
 * - When the week changes: every calendar snapshot (the labelled example change, a
 *   new .ics file, a re-read link) is checked against what you approved. An approved
 *   time that is now busy is BLOCKED at once. The wall keeps the old time (CONFLICT)
 *   and offers up to two others; pinching one is only a trial; a fresh hold approves
 *   the exact card shown, and the old item stays as history with nothing to hand off.
 * - Moving things: the board and the desk card each have a grab bar, like a Quest
 *   window. Pinch the bar and move your hand; push away to send it farther. A board
 *   let go near a real wall snaps onto it.
 * - Saving: the plan, the outbox and the example change are kept in localStorage.
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
import { Board, INVITE, type CalendarButtonView, type ReviewView } from './board.js';
import { CHIPS } from './chips.js';
import { activeCalendar, refreshLinked, savedCalendar } from './calendar-source.js';
import { runAgent, understandRule, type AgentResult, type FetchLike } from './logic/agent.js';
import { heldBy, holdsTime, withApproved } from './logic/approved.js';
import { EXAMPLE, exampleApproval, exampleBlock, isExampleBlock, withExample } from './logic/example-change.js';
import { slotInstant } from './logic/handoff.js';
import {
  itemSlot,
  kindOf,
  needsReview,
  overlapsOf,
  planForItem,
  refreshReview,
  replacementTradeOff,
  revalidate,
  startReview,
  usable,
  whenLabel,
  type Review,
} from './logic/review.js';
import { cardScale, chooseDesk, faceEyes, type DeskPlacement } from './logic/desk.js';
import { along, centreFromGrab, DRAG, facing, pushPull, snapToWall } from './logic/drag.js';
import { HOLD, HoldToApprove } from './logic/hold.js';
import { PlacementController } from './logic/placement-controller.js';
import { boardScaleFor, fallbackPlacement, isWallLabel, type PlaneInput, type Placement } from './logic/placement.js';
import { parsePrint, SAME_WALL, serializePrint, wallPrint, type WallPrint } from './logic/same-wall.js';
import {
  addToOutbox,
  approve,
  freshId,
  buildReceipt,
  chooseSlot,
  isLinked,
  makePlan,
  removeFromOutbox,
  unapprove,
  UNSEND_SECONDS,
  type OutboxItem,
  type Plan,
} from './logic/plan.js';
import { parseRequest, ruleText } from './logic/request.js';
import { clock, dayLabel, type BusyBlock, type CalendarData } from './logic/scheduler.js';
import { restore, serialize, STORAGE_KEY } from './logic/storage.js';
import { tradeOff, weekModel, type WeekModel } from './logic/week.js';
import { muralAction, withoutRule, type MuralAction } from './logic/touch-week.js';
import { focusTradeOff, focusWindows, isFocus } from './logic/focus.js';
import { nextSteps, prepBlock, reminderItem, type NextStep, type NextStepKind } from './logic/next-step.js';
import type { WeekBlock } from './logic/week.js';
import type { AgentCardView } from './board.js';
import { palmNormal, PalmSummon, palmTowardFace, type P3 } from './logic/palm.js';
import { afterSendLine, lineFor, type ClipId, type SpokenLine } from './logic/lines.js';
import { clipState, preloadClips, setSpeechEnabled, speak, speechEnabled, stopSpeaking } from './ui/voice-out.js';
import { playApproved, playTick, unlockAudio } from './ui/sound.js';
import type { InviteExtras } from './ui/cards.js';
import { VoiceInput } from './voice.js';
import { fitScale, fovFromDegrees, fovFromProjection, inView, type Fov } from './logic/fov.js';
import { makeFocusPlan } from './logic/focus.js';
import {
  addCorrection,
  decline,
  emptyLearn,
  LEARN_KEY,
  parseLearn,
  proposeRule,
  serializeLearn,
  settle,
  type LearnState,
  type RuleProposal,
} from './logic/learn.js';
import {
  allClear,
  emptyQueue,
  itemForTask,
  localDay,
  markDone,
  nextItem,
  parseQueue,
  QUEUE,
  QUEUE_KEY,
  queueLine,
  serializeQueue,
  type QueueState,
} from './logic/queue.js';
import { mergeConstraint } from './logic/request.js';
import { makeMovePlan, movableAt, withMoved, withoutBlock } from './logic/move.js';
import type { Moving } from './logic/plan.js';
import { BOARD } from './logic/placement.js';
import type { Constraint, Slot } from './logic/scheduler.js';

/** The sample week, or your own calendar when you set one up on the start page. */
const ACTIVE = activeCalendar();
const baseCalendar: CalendarData = ACTIVE.cal;
/** The Worker URL is set at build time (GitHub Actions variable). Empty = rules only. */
const AGENT_URL: string = String(import.meta.env.VITE_AGENT_URL ?? '').trim();
const MODEL_LABEL = 'Groq';
/** Each chip's rule, parsed once (not every frame). */
const CHIP_RULES = CHIPS.map((c) => parseRequest(c.say, baseCalendar).rule);
/** Approvals carry the calendar they were made on. */
const SOURCE: 'sample' | 'yours' = ACTIVE.real ? 'yours' : 'sample';
/** Your own calendar came from a link: it can be read again from the wall. */
const LINKED = ACTIVE.real && savedCalendar()?.source === 'link';

/** An Object3D as IWSDK's pointer system (@pmndrs/pointer-events) sees it. */
interface PointerHit {
  pointerId: number;
  pointerType: string;
  /** Where on the mesh's texture the ray hit (0..1). */
  uv?: { x: number; y: number };
  /** The hit in world space. While a pinch is captured it stays on the ray, at the distance of the first hit. */
  point?: { x: number; y: number; z: number };
  /** Where the ray starts in world space (the hand, or the camera for a mouse). */
  pointerPosition?: { x: number; y: number; z: number };
}

interface PointerTarget {
  addEventListener(
    type: 'pointerdown' | 'pointermove' | 'pointerleave' | 'pointerup' | 'pointercancel',
    listener: (e: PointerHit) => void,
  ): void;
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
  | { kind: 'chip' | 'alt' | 'replan' | 'candidate'; index: number }
  | { kind: 'invite' | 'move' | 'voice' | 'review-cancel' | 'calendar'; index: 0 }
  | { kind: 'mural'; index: 0; u: number; v: number };

/** Voice on/off, remembered in this browser. */
const VOICE_KEY = 'agentwall.voice';

/** A next-step offer nobody answers is skipped after this many seconds, so the demo moves on. */
const NEXT_STEP_TIMEOUT = 25;

type AgentCard = AgentCardView & { kind: 'example' | NextStepKind | 'queue' | 'rule' | 'move' };

/** Used for the desk hint until the device's own view angles are known. */
const DEFAULT_FOV = fovFromDegrees(110, 96);
const today = () => localDay(new Date());

/** The same meeting (day and time)? */
const same = (a: Moving | undefined, b: Moving) => !!a && a.day === b.day && a.start === b.start && a.end === b.end;

function greeting(hour: number): string {
  return hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
}

/** A hold is a still hand: farther than this from where the pinch began, the hold is cancelled. */
const HOLD_STILL_M = 0.08;
/** A pinch on the card this soon after an approval is the same pinch bouncing as it lets go, not an Unsend. */
const UNSEND_GRACE_S = 0.5;

/** Seconds to look at the new spot after pinching "Move board". */
export const MOVE_SECONDS = 3;

type PlacementRequest = { useMemory: boolean; anyAngle?: boolean; why?: 'move' | 'recenter' | 'summon' };

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
  desk: () => { kind: string; position: number[]; visible: boolean; scale: number } | null;
  /** Grab bars: what is being dragged now, how many drags ended, the board's status chip. */
  drag: () => { active: string | null; count: number; cardPlacedByYou: boolean; status: string };
  /** The week mural: sweep still playing? how many half hours ruled out? */
  mural: () => { visible: boolean; sweeping: boolean; ruledOut: number; fresh: number };
  /** Unsend window and conflict state. */
  flow: () => { sendingLeft: number | null; conflict: string | null; clock: number; moving: boolean; card: string | null; prep: boolean; voiceOn: boolean; startHint: boolean; boardScale: number };
  /** The conflict under review: the old time, the other times, the one on trial, what was understood. */
  review: () => {
    item: string | null;
    old: string;
    reason: string;
    detail: string;
    candidates: Array<{ id: string; label: string; why: string }>;
    trial: number | null;
    heard: Review['heard'];
    bar: boolean;
    chips: number;
  } | null;
  /** The calendar control beside the outbox: its label now, or null when hidden. */
  calendarControl: () => { label: string; sub: string; primary: boolean } | null;
  /** The same as pinching the calendar control (the labelled example change, or a re-read of your link). */
  calendarChange: () => Promise<void>;
  /** Test hook: no sweep and no flight, as with "reduce motion" switched on. */
  setReducedMotion: (on: boolean) => void;
  /** Test hook: a newer snapshot arrives with a busy block over the time on the desk right now (as a re-read during a hold would). */
  changeUnderHand: () => boolean;
  /** Same path as Quest's recenter (XRReferenceSpace 'reset'). */
  recenter: () => void;
  muralPoint: (dayIndex: number, minute: number) => [number, number, number] | null;
  weekCells: () => Array<{ day: string; start: number; kind: string; reason: string }>;
  setMoveSeconds: (seconds: number) => void;
  setLateWallSeconds: (seconds: number) => void;
  /** Seconds since the placement controller last started. */
  placementAge: () => number;
  setFlySlowdown: (k: number) => void;
  /** The agent's last spoken line. */
  spoken: () => string;
  /** Voice clips: how many loaded, which played last. */
  voiceClips: () => { loaded: number; total: number; lastPlayed: string | null };
  setPalmHoldSeconds: (seconds: number) => void;
  /** Palm-up summon state (per hand: angle to the face, distance, pinch gap). */
  palm: () => { hands: Array<{ hand: string; angle: number; dist: number; pinch: number; facing: boolean }>; progress: number; cue: boolean; ms: number };
  /** Kept for older test scripts: there is no automatic change any more, so this does nothing. */
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
  /** Which calendar the wall shows: the sample week or your own. Never the event titles. */
  calendar: () => { real: boolean; label: string; days: string[]; busy: number; guest: string };
  /** The morning queue: today's ticks, the days in a row, the header line. */
  queue: () => QueueState & { line: string; running: boolean };
  /** Your corrections of the agent's picks, and the rule it is offering now. */
  learned: () => LearnState & { offer: string | null };
  /** Field of view: the device's angles, the board's scale and what placement asked for. */
  view: () => { fovDeg: number[] | null; scale: number; asked: number | null; deskHint: boolean; gaze: boolean };
  /** Test hook: pretend the device sees this many degrees (null = read the real device again). */
  setFov: (hDeg: number | null, vDeg?: number) => void;
  /** Test hook: show the queue card again (as entering the app does). */
  offerQueue: () => boolean;
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
  private voiceEntity!: Entity;
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
  /** The conflict being reviewed: the old time, the other times, the one on trial. */
  private review: Review | null = null;
  /** What the desk shows in a review while nothing is on trial: the old card, blocked. */
  private reviewBase: Plan | null = null;
  /** Busy blocks the labelled example change added to the sample week (saved with the board). */
  private exampleBlocks: BusyBlock[] = [];
  /** After a first approval the calendar control is offered as the next thing to try. */
  private suggestCalendar = false;
  private refreshing = false;
  private candidateEntities: Entity[] = [];
  private reviewCancelEntity!: Entity;
  private calendarEntity!: Entity;
  /** Views handed to the board, rebuilt only when what they show changes (never per frame). */
  private extras: { plan: Plan | null; review: Review | null; tradeOff: string | null; change: { was: string; now: string } | null } = {
    plan: null,
    review: null,
    tradeOff: null,
    change: null,
  };
  private reviewViewOf: { review: Review | null; plan: Plan | null; view: ReviewView | null } = { review: null, plan: null, view: null };
  private calendarView: { reviewing: boolean; stale: OutboxItem | null; refreshing: boolean; suggest: boolean; view: CalendarButtonView | null } | null = null;
  /** The blocked item that waits for a review, looked up only when the outbox changes. */
  private staleOf: { outbox: OutboxItem[] | null; item: OutboxItem | null } = { outbox: null, item: null };
  private holdLabelOf: { plan: Plan | null; label: string } = { plan: null, label: '' };
  /** The agent's card on the wall: a next-step offer, the queue, or the example. */
  private card: AgentCard | null = null;
  private cardShownAt = 0;
  /** Next-step offers still to show, in order. */
  private steps: NextStep[] = [];
  /** Palm toward your face for a second: the board comes to you. */
  private palmSummon = new PalmSummon();
  /** Smoothed cost of the palm check per frame (ms), for the test hook. */
  private palmMs = 0;
  private palmDebug: Array<{ hand: string; angle: number; dist: number; pinch: number; facing: boolean }> = [];
  /** The agent's last spoken line (also kept when the device has no voice). */
  private lastSpoken = '';
  /** The prep block you said yes to (shown on the week; belongs to the call). */
  private prep: WeekBlock | null = null;
  private fresh = new Set<string>();
  private deskPlace: DeskPlacement | null = null;
  /** A pinch that started on the invite and has not been released yet. */
  private inviteHeld = false;
  /** Where the hand was when the pinch on the card began (see HOLD_STILL_M). */
  private holdFrom: { x: number; y: number; z: number } | null = null;
  /** What the week on the wall was last built from (see currentWeek). */
  private weekOf: { outbox: OutboxItem[] | null; plan: Plan | null; cal: CalendarData | null; own: string | null; standing: string; shown: CalendarData } = {
    outbox: null,
    plan: null,
    cal: null,
    own: null,
    standing: '',
    shown: baseCalendar,
  };
  private releaseHold: () => void = () => {};
  private unsendSeconds = UNSEND_SECONDS;
  /** The morning queue: what still needs your OK today, and the days in a row. */
  private queue: QueueState = parseQueue(readStorage(QUEUE_KEY), today());
  /** You pinched Start on the queue card: after each send the agent offers the next item. */
  private queueRunning = false;
  /** The last item just went out: say "all clear" once the follow-up offers are answered. */
  private queueJustCleared = false;
  /** Your corrections of the agent's picks, and the rule it may offer from them. */
  private learn: LearnState = parseLearn(readStorage(LEARN_KEY));
  private ruleOffer: RuleProposal | null = null;
  /** The meeting you pinched, while the agent asks whether to move it. */
  private moveOffer: Moving | null = null;
  /** Bumped when the calendar itself changes (a meeting was moved), so the week redraws. */
  private calVersion = 0;
  /** This device's real view angles (from its projection), or a test override. */
  private fov: Fov | null = null;
  private fovOverride: Fov | null = null;
  private placed: Placement | null = null;
  private gazeOn = false;
  /** A grab bar is pinched: what moves, and where on it the pinch landed. */
  private drag: { what: 'board' | 'card'; pointerId: number; d0: number; r0: number; lx: number; ly: number; moved: boolean } | null =
    null;
  /** Where the pinch landed, and how the card was turned in the last frame of a drag. */
  private dragStart = new Vector3();
  private dragYaw = 0;
  private dragTilt = 0;
  private dragPoint = new Vector3();
  private dragOrigin = new Vector3();
  private dragDirty = false;
  private dragEuler = new Euler(0, 0, 0, 'YXZ');
  private dragQuat = new Quaternion();
  private dragOffset = new Vector3();
  private dragCount = 0;
  /** You dragged the card somewhere: it stays there until the room's coordinates change. */
  private deskUserPlaced = false;
  private boardGrabEntity!: Entity;
  private deskGrabEntity!: Entity;

  init(): void {
    this.board = new Board();
    const boardEntity = this.world.createTransformEntity(this.board.object);
    const deskEntity = this.world.createTransformEntity(this.board.desk);
    this.world.createTransformEntity(this.board.palm);
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
    this.voiceEntity = interactive(this.board.voiceButton.mesh, boardEntity);
    this.candidateEntities = this.board.candidateButtons.map((b) => interactive(b.mesh, boardEntity));
    this.reviewCancelEntity = interactive(this.board.reviewCancel.mesh, boardEntity);
    this.calendarEntity = interactive(this.board.calendarButton.mesh, boardEntity);
    this.boardGrabEntity = interactive(this.board.boardGrab.mesh, boardEntity);
    this.deskGrabEntity = interactive(this.board.deskGrab.mesh, deskEntity);
    if (readStorage(VOICE_KEY) === 'off') setSpeechEnabled(false);
    // The board itself is a (do-nothing) ray target: IWSDK only shows the hand ray's
    // cursor on targets, and the first Quest tester saw no pointer until exactly on a chip.
    this.backEntity = interactive(this.board.backPanel.mesh, boardEntity);
    // The agent's card is a (do-nothing) ray target as well: a pinch on its body, or one that misses
    // a button by a few centimetres, must not go through it to the week or a pill behind it.
    interactive(this.board.replanPanel.mesh, boardEntity);
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
    onPress(this.board.voiceButton.mesh, { kind: 'voice', index: 0 });
    this.board.candidateButtons.forEach((b, i) => onPress(b.mesh, { kind: 'candidate', index: i }));
    onPress(this.board.reviewCancel.mesh, { kind: 'review-cancel', index: 0 });
    onPress(this.board.calendarButton.mesh, { kind: 'calendar', index: 0 });
    // Grab bars: the captured ray keeps reporting where it points, so the thing follows the hand.
    const grab = (mesh: unknown, what: 'board' | 'card') => {
      const target = mesh as PointerTarget;
      target.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        capture(target, e);
        this.startDrag(what, e);
      });
      target.addEventListener('pointermove', (e) => this.moveDrag(e));
      target.addEventListener('pointerup', () => this.endDrag());
      target.addEventListener('pointercancel', () => this.endDrag());
    };
    grab(this.board.boardGrab.mesh, 'board');
    grab(this.board.deskGrab.mesh, 'card');
    // A pinch on the bare board does nothing, but it still captures the ray so the
    // release always arrives (see capture()).
    const back = this.board.backPanel.mesh as unknown as PointerTarget;
    back.addEventListener('pointerdown', (e) => capture(back, e));
    const cardBody = this.board.replanPanel.mesh as unknown as PointerTarget;
    cardBody.addEventListener('pointerdown', (e) => capture(cardBody, e));
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
      this.holdFrom = e.pointerPosition ? { x: e.pointerPosition.x, y: e.pointerPosition.y, z: e.pointerPosition.z } : null;
      this.presses.push({ kind: 'invite', index: 0 });
    });
    // A hold is a still hand. A hand that travels while it pinches the card is trying to move it
    // (a Quest window is grabbed anywhere): that must not fill the ring and approve. The mouse has
    // no hand position (the ray starts at the camera), so this never fires on the desktop.
    invite.addEventListener('pointermove', (e) => {
      const from = this.holdFrom;
      const at = e.pointerPosition;
      if (!this.inviteHeld || !from || !at || this.hold.progress <= 0) return;
      if (Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z) > HOLD_STILL_M) {
        this.holdFrom = null;
        this.cancelHold('your hand moved · to move the card, pinch the bar under it');
      }
    });
    const release = () => {
      this.inviteHeld = false;
      this.endDrag(); // the hand opened: whatever was being moved stays where it is
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
      // The example change is part of the saved board: the conflict it made is still on the wall.
      this.exampleBlocks = saved.example;
      this.cal = withExample(baseCalendar, saved.example);
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
    this.board.setQueueLine(queueLine(this.queue), allClear(this.queue));
    this.board.setSourceLabel(ACTIVE.label, ACTIVE.real);
    // The calendar on the wall is the newest one known (a new file or a re-read link was
    // loaded before the board): everything approved is checked against it before anything else.
    this.recheck();
    // An invite that was mid-Unsend when the app closed counts as sent (above). Write that down
    // now, so the start page lists it without waiting for the next change.
    if (saved?.outbox.some((o) => o.status === 'sending')) this.save();
    if (!this.review) this.firstCard();

    // A judge may enter through Quest Browser's own Enter button, which never clicks our
    // page, so sound would stay locked. XR select (pinch) events count as a user
    // gesture: unlock audio on the first pinch of each session.
    const onSessionStart = () => {
      const session = this.xrManager.getSession();
      session?.addEventListener('selectstart', unlockAudio, { once: true });
      // The hand opened (or tracking ended): the invite hold stops.
      session?.addEventListener('selectend', () => this.releaseHold());
      // A hand left tracking in the middle of a hold: that hold is over, whatever the pinch did.
      session?.addEventListener('inputsourceschange', (e) => {
        if ((e as XRInputSourcesChangeEvent).removed?.length) this.cancelHold('hand tracking was lost');
      });
      session?.addEventListener('end', () => {
        this.releaseHold();
        this.detachReset();
      });
    };
    this.xrManager.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onSessionStart));

    let wasFlat: boolean | null = null;
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        // The system menu or another layer took over: a hold in progress does not count.
        if (v === VisibilityState.VisibleBlurred) this.cancelHold('the view was interrupted');
        // Entering or leaving mixed reality changes the coordinates: a hand-placed card starts over.
        const nowFlat = v === VisibilityState.NonImmersive;
        if (nowFlat !== wasFlat) {
          this.drag = null;
          this.deskUserPlaced = false;
        }
        wasFlat = nowFlat;
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
    this.updateDrag();
    this.updateView();
    const palmT0 = performance.now();
    this.updatePalm(delta);
    this.palmMs = this.palmMs * 0.95 + (performance.now() - palmT0) * 0.05;
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

  /**
   * Palm-up summon. Reads WebXR hand joints (wrist, index and pinky knuckles,
   * thumb and index tips) in the session's reference space; the board lives in the
   * same space (the player rig is never moved in this app).
   */
  private updatePalm(delta: number): void {
    const session = this.xrManager.getSession();
    const frame = this.xrManager.getFrame();
    const ref = this.xrManager.getReferenceSpace();
    this.palmDebug = [];
    if (!session || !frame || !ref || !this.board.object.visible) {
      this.palmSummon.update(delta, false);
      this.board.setPalmCue(false);
      return;
    }
    const head = frame.getViewerPose(ref)?.transform.position;
    let facingAt: { at: P3; normal: P3 } | null = null;
    for (const src of session.inputSources) {
      const hand = src.hand;
      if (!hand || !head || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const joint = (name: XRHandJoint): P3 | null => {
        const space = hand.get(name);
        const pose = space ? frame.getJointPose?.(space, ref) : undefined;
        return pose ? pose.transform.position : null;
      };
      const wrist = joint('wrist');
      const indexK = joint('index-finger-metacarpal');
      const pinkyK = joint('pinky-finger-metacarpal');
      const thumbTip = joint('thumb-tip');
      const indexTip = joint('index-finger-tip');
      const middleK = joint('middle-finger-metacarpal');
      if (!wrist || !indexK || !pinkyK || !thumbTip || !indexTip || !middleK) continue;
      const normal = palmNormal(wrist, indexK, pinkyK, src.handedness);
      const at = {
        x: (wrist.x + indexK.x + pinkyK.x) / 3,
        y: (wrist.y + indexK.y + pinkyK.y) / 3,
        z: (wrist.z + indexK.z + pinkyK.z) / 3,
      };
      const fingers = { x: middleK.x - wrist.x, y: middleK.y - wrist.y, z: middleK.z - wrist.z };
      const facing = palmTowardFace(at, normal, head, thumbTip, indexTip, fingers);
      const toHead = { x: head.x - at.x, y: head.y - at.y, z: head.z - at.z };
      const dist = Math.hypot(toHead.x, toHead.y, toHead.z);
      const cos = (normal.x * toHead.x + normal.y * toHead.y + normal.z * toHead.z) / (dist || 1);
      this.palmDebug.push({
        hand: src.handedness,
        angle: Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI),
        dist: Math.round(dist * 100) / 100,
        pinch: Math.round(Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z) * 1000) / 1000,
        facing,
      });
      if (facing) facingAt = { at, normal };
    }
    const event = this.palmSummon.update(delta, facingAt !== null && !this.inviteHeld);
    if (event === 'charging' && facingAt && head) {
      const n = facingAt.normal;
      const cue = { x: facingAt.at.x + n.x * 0.07, y: facingAt.at.y + n.y * 0.07, z: facingAt.at.z + n.z * 0.07 };
      this.board.setPalmCue(true, cue, head, this.palmSummon.progress);
    } else {
      this.board.setPalmCue(false);
    }
    if (event === 'summon') {
      this.requestPlacement({ useMemory: false, why: 'summon' });
      playTick();
    }
  }

  /** The agent says one short line (silent if the device has no voice, or the mic is on). */
  private speakMoment(id: ClipId): void {
    this.speakLine(lineFor(id));
  }

  private speakLine(line: SpokenLine): void {
    this.lastSpoken = line.text;
    if (this.voice?.state && this.voice.state !== 'idle') return;
    preloadClips(); // once audio is allowed: fetch all clips so later lines play at once
    speak(line);
  }

  private say(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok' | 'alert'): void {
    this.agentLineText = text;
    this.board.setAgentLine(text, tone);
  }

  // ---------- drawing state ----------

  private currentWeek(): WeekModel | null {
    if (!this.plan) return null;
    const moving = this.plan.moving;
    const focus = isFocus(this.plan) || !!moving;
    // In a review the week is drawn for the limit the review searches in. That is the item's own
    // limit, or none when that limit had no room left: the times on offer must not look ruled out.
    const constraint = this.review ? this.review.rule : this.plan.constraint;
    // What you approved is part of your week: drawn as your own blocks, as the agent sees them.
    // The one the desk card itself shows is left out: that is the gold time.
    if (this.weekOf.outbox !== this.outbox || this.weekOf.plan !== this.plan || this.weekOf.cal !== this.cal) {
      const mine = this.plan.approval === 'approved' && this.plan.slot ? (heldBy(this.outbox, this.plan.slot)?.id ?? null) : null;
      this.weekOf = {
        outbox: this.outbox,
        plan: this.plan,
        cal: this.cal,
        own: mine,
        standing: this.outbox.filter(holdsTime).map((o) => o.slotId).join(),
        shown: withApproved(this.cal, this.outbox, mine),
      };
    }
    const { own, standing, shown: cal } = this.weekOf;
    const key = JSON.stringify([constraint, cal.busy.guest.length, cal.busy.owner.length, this.prep, focus, moving ?? null, this.calVersion, own, standing]);
    if (key !== this.weekKey) {
      this.weekKey = key;
      // A meeting being moved does not block its own new time; it is drawn where it is now.
      const week = moving
        ? weekModel(withoutBlock(cal, moving), constraint, { focus: true, minutes: moving.end - moving.start })
        : weekModel(cal, constraint, { focus });
      const extra: WeekBlock[] = [];
      if (moving && cal.busy.owner.length !== withoutBlock(cal, moving).busy.owner.length) {
        extra.push({ day: moving.day, start: moving.start, end: moving.end, who: 'you', title: `${moving.title} (now)` });
      }
      // The agent's prep block is shown, but never counts against the call it belongs to.
      if (this.prep) extra.push(this.prep);
      this.week = extra.length ? { ...week, blocks: [...week.blocks, ...extra] } : week;
    }
    return this.week;
  }

  private inviteExtras(): InviteExtras {
    const plan = this.plan;
    const rv = this.review;
    if (plan && (plan !== this.extras.plan || rv !== this.extras.review)) {
      const trial = rv !== null && rv.trial !== null && plan.slot !== null;
      this.extras = {
        plan,
        review: rv,
        // On trial: one computed line about the new time. Otherwise the usual catch, if any.
        tradeOff: !plan.slot
          ? null
          : trial
            ? replacementTradeOff(this.cal, rv!.kind, rv!.old, plan.slot)
            : plan.moving
              ? null
              : isFocus(plan)
                ? focusTradeOff(this.cal, focusWindows(this.cal, plan.constraint), plan.slot)
                : tradeOff(this.cal, plan.slot, plan.constraint),
        change: trial ? { was: whenLabel(rv!.old), now: whenLabel(plan.slot!) } : null,
      };
    }
    const item = this.currentItemId ? this.outbox.find((o) => o.id === this.currentItemId) : undefined;
    return {
      tradeOff: this.extras.tradeOff,
      sendingLeft:
        this.sendingUntil !== null ? Math.max(1, Math.ceil(this.sendingUntil - this.clockS)) : null,
      receipt: item?.status !== 'sending' ? (item?.receipt ?? null) : null,
      // Blocked: the old card in a review, or (review put off) the card of a blocked item.
      conflict: rv && rv.trial === null ? rv.reason : !rv && item?.blocked ? item.blocked.text : null,
      change: this.extras.change,
    };
  }

  /** What the review bar and the week show, rebuilt only when the review or the plan changes. */
  private reviewView(): ReviewView | null {
    const rv = this.review;
    const plan = this.plan;
    if (rv === this.reviewViewOf.review && plan === this.reviewViewOf.plan) return this.reviewViewOf.view;
    let view: ReviewView | null = null;
    if (rv) {
      const example = !ACTIVE.real && this.exampleBlocks.length > 0;
      const times = rv.candidates.map((c) => c.label).join(' and ');
      const heard = rv.heard
        ? `${rv.heard.by === 'ai' ? 'LIVE AI' : 'RULES'} understood “${rv.heard.text}” · ${
            rv.candidates.length === 0 ? 'no time fits that' : rv.heard.changed ? `now ${times}` : 'the same times still fit'
          }`
        : '';
      // The item's own limit had no room left, so the whole week was searched: say which limit was dropped.
      const widened = !rv.heard && rv.widened ? `No other time fits “${rv.widened}” · these are the nearest in the week` : '';
      view = {
        title: example ? 'CONFLICT · EXAMPLE CHANGE' : 'CONFLICT',
        reason: rv.candidates.length === 0 ? `${rv.reason} · no other time fits this week` : rv.reason,
        detail: rv.detail,
        note: heard || widened,
        noteAi: rv.heard?.by === 'ai',
        candidates: rv.candidates,
        trial: rv.trial,
        cancel: rv.trial !== null ? 'Cancel' : rv.candidates.length === 0 ? 'OK' : 'Not now',
        old: rv.old,
        preview: rv.trial !== null && plan?.approval === 'needs',
      };
    }
    this.reviewViewOf = { review: rv, plan, view };
    return view;
  }

  private renderBoard(): void {
    this.board.render(
      {
        plan: this.plan,
        week: this.currentWeek(),
        invite: this.inviteExtras(),
        card: this.card
          ? { title: this.card.title, text: this.card.text, yes: this.card.yes, no: this.card.no, tone: this.card.tone, hint: this.card.hint }
          : null,
        fresh: this.fresh,
        review: this.reviewView(),
      },
      this.animateNext,
    );
    if (this.plan) this.animateNext = true;
  }

  // ---------- asking the agent ----------

  /** Chips, voice, re-plan and test hooks all come through here. */
  private async ask(text: string, heard = ''): Promise<AgentResult | null> {
    // In a conflict review what you say is a limit for the search, nothing more.
    if (this.review) return this.reviewAsk(text, heard);
    // A rule said while a meeting is being moved narrows the move; it does not start a new task.
    const moving = this.plan?.moving;
    if (moving && this.plan) {
      const parsed = parseRequest(text, this.cal);
      if (parsed.intent === 'rule' || parsed.intent === 'clear') {
        const rule = parsed.intent === 'clear' ? {} : mergeConstraint(this.plan.constraint, parsed.rule);
        const plan = makeMovePlan(this.planCal(), moving, rule, ruleText(rule), this.plan);
        this.setPlan(plan);
        playTick();
        this.say(`Planned by rules${heard ? ` · ${heard}` : ''}`, 'warn');
        return { plan, by: 'rules', note: '' };
      }
    }
    const id = ++this.requestId;
    this.busy = true;
    this.say(heard ? `${heard} · thinking…` : 'Thinking…', 'ai');
    const t0 = performance.now();
    let result: AgentResult;
    try {
      result = await runAgent(this.planCal(), text, this.plan, { url: this.agentUrl, fetch: this.fetchImpl });
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
    if (result.plan.slot) {
      this.speakMoment(isFocus(result.plan) ? 'planned-focus' : 'planned');
    }
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
        if (chip.id === 'mic') {
          stopSpeaking(); // the mic must not hear the agent
          void this.voice.toggle();
        }
        else if (!this.busy) void this.ask(chip.say);
      } else if (press.kind === 'alt') {
        const plan = this.plan;
        const alt = plan?.alternatives[press.index];
        if (plan && alt && !this.busy) {
          this.animateNext = false; // your own pick: no need to replay the agent's sweep
          this.noteCorrection(plan, alt);
          this.setPlan(chooseSlot(this.cal, plan, alt));
          this.say('You picked this time', 'muted');
          playTick();
          this.offerRule();
        }
      } else if (press.kind === 'replan') {
        if (this.card === null || this.busy) continue;
        this.answerCard(press.index === 0);
      } else if (press.kind === 'candidate') {
        this.tryCandidate(press.index);
      } else if (press.kind === 'review-cancel') {
        this.cancelReview();
      } else if (press.kind === 'calendar') {
        void this.checkCalendar();
      } else if (press.kind === 'invite' && this.sendingUntil !== null) {
        if (this.clockS - (this.sendingUntil - this.unsendSeconds) > UNSEND_GRACE_S) this.unsend();
      } else if (press.kind === 'voice') {
        const on = !speechEnabled();
        setSpeechEnabled(on);
        writeStorage(on ? null : 'off', VOICE_KEY);
        this.say(on ? 'Voice on' : 'Voice off · the board still shows every line', 'muted');
        if (on) this.speakMoment('voice-on');
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
      // The card changed under the user's fingers: that hold is over, and the pinch
      // still down cannot carry on into the new card.
      this.hold.cancel();
      this.holdPlanVersion = current.version;
    }
    // A blocked card (the old time in a review) can never be approved: only a trial can.
    const blockedCard = this.review !== null && this.review.trial === null;
    const canApprove =
      live &&
      !this.busy &&
      !this.board.sweeping &&
      current?.invite != null &&
      current.approval === 'needs' &&
      !blockedCard &&
      this.drag === null;
    const pressed = this.inviteHeld || this.inviteEntity.hasComponent(Pressed);
    if (!this.board.desk.visible) this.inviteHeld = false;
    if (pressed) this.controller.lock();
    const event = this.hold.update(delta, pressed, canApprove);
    if (event === 'complete' && current) this.approveNow(current);
    else if (event === 'released') this.say('Let go early · nothing was approved · hold for one full second', 'muted');
    this.peakHold = Math.max(this.peakHold, this.hold.progress);
    // The ring says exactly what it approves.
    this.board.setHold(this.hold.progress, canApprove && current?.slot ? this.holdLabelFor(current) : '');
    this.board.setHover(
      canApprove && this.inviteEntity.hasComponent(Hovered),
      this.hoveredIndex(this.altEntities),
      this.hoveredIndex(this.replanEntities),
      this.hoveredIndex(this.candidateEntities),
      this.reviewCancelEntity.hasComponent(Hovered),
    );
    this.board.setCalendarButton(this.calendarControl(), this.calendarEntity.hasComponent(Hovered));
    const dragging = this.drag?.what;
    this.board.setGrab('board', dragging === 'board' ? 'drag' : this.boardGrabEntity.hasComponent(Hovered) ? 'hover' : 'idle');
    this.board.setGrab('card', dragging === 'card' ? 'drag' : this.deskGrabEntity.hasComponent(Hovered) ? 'hover' : 'idle');
    this.updateMuralHover();
    this.board.setVoiceButton(speechEnabled(), this.voiceEntity.hasComponent(Hovered));
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
    const action = muralAction(this.cal, this.plan, week, spot.dayIndex, spot.minute);
    // In a review the week only explains: the two targets above it are the way to choose.
    if (this.review && action && action.kind !== 'explain') {
      const when = `${dayLabel(action.cell.day).short.split(' ')[0]} ${clock(action.cell.start)}`;
      return { kind: 'explain', text: `${when} · ${action.cell.reason}`, cell: action.cell };
    }
    return action;
  }

  private pressMural(u: number, v: number): void {
    const action = this.muralActionAt(u, v);
    const plan = this.plan;
    if (!action || !plan) return;
    if (action.kind === 'pick') {
      if (plan.slot?.id === action.slot.id) return;
      this.animateNext = false; // your own pick: no need to replay the agent's sweep
      this.noteCorrection(plan, action.slot);
      this.setPlan(chooseSlot(this.cal, plan, action.slot));
      this.say(`You picked ${shortWhen(action.slot.day, action.slot.start)}`, 'muted');
      playTick();
      this.offerRule();
    } else if (action.kind === 'remove-rule') {
      const next = withoutRule(plan.constraint, action.key);
      this.setPlan(this.planWith(plan, next));
      this.say(`Removed your rule "${action.label}" · the agent re-planned`, 'ok');
      this.speakMoment('rule-removed');
      playTick();
    } else {
      this.say(action.text, 'muted');
      // Your own meeting: the agent offers to move it. Nothing moves without your hold.
      const meeting = movableAt(this.cal, action.cell.day, action.cell.start);
      if (meeting && !this.card && !this.review && this.sendingUntil === null && !same(plan.moving, meeting)) {
        this.moveOffer = meeting;
        this.card = {
          kind: 'move',
          title: 'MOVE THIS MEETING?',
          text: `${meeting.title}, ${shortWhen(meeting.day, meeting.start)}. I will look for another time on your calendar.`,
          yes: 'Find a time',
          no: 'Leave it',
          tone: 'next',
        };
        this.cardShownAt = this.clockS;
      }
    }
  }

  /** Light up the free time or the rule under the hand ray (redraws only on change). */
  private updateMuralHover(): void {
    const uv = this.muralUv;
    const key = uv ? `${uv.u.toFixed(3)},${uv.v.toFixed(3)}|${this.plan?.version ?? 0}|${this.board.sweeping}` : '';
    if (key === this.muralUvKey) return;
    this.muralUvKey = key;
    const action = uv ? this.muralActionAt(uv.u, uv.v) : null;
    if (action?.kind === 'explain' && !this.review && movableAt(this.cal, action.cell.day, action.cell.start) && this.sendingUntil === null) {
      const meeting = movableAt(this.cal, action.cell.day, action.cell.start);
      this.board.setMuralHover({
        kind: 'rule',
        day: action.cell.day,
        start: action.cell.start,
        reason: action.cell.reason,
        label: `Pinch to move: ${meeting?.title ?? 'meeting'}`,
      });
    } else if (!action || action.kind === 'explain') {
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

  /** "HOLD TO APPROVE · Wed 5:30 PM": the ring's own label. */
  private holdLabelFor(plan: Plan): string {
    if (this.holdLabelOf.plan !== plan) {
      this.holdLabelOf = { plan, label: plan.slot ? `HOLD TO APPROVE · ${whenLabel(plan.slot)}` : '' };
    }
    return this.holdLabelOf.label;
  }

  /** Is this plan's time busy on the newest calendar known? (A moved meeting never blocks itself.) */
  private planOverlaps(plan: Plan): boolean {
    if (!plan.slot) return false;
    const cal = plan.moving ? withoutBlock(this.cal, plan.moving) : this.cal;
    return overlapsOf(cal, plan.slot, undefined, isFocus(plan) || !!plan.moving).length > 0;
  }

  /** The calendar the agent plans on: what was read, plus what you already approved (it is busy time now). */
  private planCal(): CalendarData {
    return withApproved(this.cal, this.outbox);
  }

  private approveNow(current: Plan): void {
    // The approval boundary: the time must still be free on the newest calendar known.
    if (this.planOverlaps(current)) {
      this.hold.cancel();
      this.recheck();
      return;
    }
    // One time, one approval: another approval that still stands may hold this time already
    // (you picked it on the week yourself, or it was approved after this card was planned).
    const held = current.slot ? heldBy(this.outbox, current.slot, current.replaces ?? null) : null;
    const heldAt = held ? itemSlot(held) : null;
    if (held && heldAt) {
      this.hold.cancel();
      this.say(`You already approved ${whenLabel(heldAt)} · nothing new was approved · pick another time`, 'warn');
      playTick();
      return;
    }
    // Approving a new time for a call that is blocked by a conflict replaces that call,
    // whether the new time came from the review or from planning again.
    const stale = current.replaces ? null : needsReview(this.outbox);
    const kind = current.moving ? 'move' : isFocus(current) ? 'focus' : 'call';
    const plan = stale && kindOf(stale) === kind ? { ...current, replaces: stale.id } : current;
    const result = approve(plan, new Date().toISOString(), {
      source: SOURCE,
      startUtc: plan.slot ? slotInstant(this.cal, plan.slot) : null,
    });
    if (!result) return;
    const item: OutboxItem = { ...result.item, id: freshId(this.outbox, result.item.id), status: 'sending' };
    this.outbox = addToOutbox(this.outbox, item);
    this.currentItemId = item.id;
    this.sendingUntil = this.clockS + this.unsendSeconds;
    this.suggestCalendar = true;
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
    this.speakMoment('unsent');
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
      const replaced = this.plan.replaces ? this.outbox.find((o) => o.id === this.plan?.replaces) : undefined;
      const oldSlot = replaced ? itemSlot(replaced) : null;
      const receipt = buildReceipt(this.cal, this.plan, week?.ruledOut ?? 0, nowLabel(), oldSlot ? whenLabel(oldSlot) : '');
      this.outbox = this.outbox.map((o) => (o.id === this.currentItemId ? { ...o, status: 'sent' as const, receipt } : o));
      // The replacement is out: the approval it replaced is superseded, for good.
      this.outbox = revalidate(this.outbox, this.cal, new Date().toISOString()).outbox;
      this.sendingUntil = null;
      this.board.setOutbox(this.outbox);
      const wasReview = this.review !== null && this.review.trial !== null;
      if (wasReview) {
        this.review = null;
        this.reviewBase = null;
      }
      this.save();
      this.say(
        oldSlot
          ? `Replaced · ${whenLabel(oldSlot)} stays as history, blocked · nothing was really sent`
          : 'In the demo outbox · nothing was really sent',
        'ok',
      );
      playTick();
      this.tickQueue(this.plan.task);
      // A moved meeting now sits at its new time, so the next task plans around it.
      if (this.plan.moving && this.plan.slot) {
        this.cal = withMoved(this.cal, this.plan.moving, this.plan.slot);
        this.calVersion++;
        this.say('Moved on the demo calendar · nothing was really sent', 'ok');
      }
      // The agent's next steps, one at a time, each needing your pinch (not after a replacement:
      // that review ends on the old item blocked and the new one ready).
      this.steps = this.plan.slot && !isFocus(this.plan) && !this.plan.moving && !wasReview ? nextSteps(this.cal, this.plan.slot) : [];
      if (wasReview) this.card = null;
      else this.nextCard(true);
    }
    // A next-step offer nobody answers is skipped, so the demo keeps moving.
    if (this.card && (this.card.kind === 'prep' || this.card.kind === 'remind') && this.clockS - this.cardShownAt > NEXT_STEP_TIMEOUT) {
      this.say('No answer · the agent skipped that suggestion', 'muted');
      this.nextCard();
    }
  }

  /** Show the next offer, or (when none are left) the queue's next item. */
  private nextCard(afterSend = false): void {
    const step = this.steps.shift();
    if (step) {
      this.card = { ...step, tone: 'next' };
      this.cardShownAt = this.clockS;
      this.speakLine(afterSend ? afterSendLine(step.kind) : lineFor(step.kind === 'prep' ? 'offer-prep' : 'offer-remind'));
      return;
    }
    if (afterSend) this.speakLine(afterSendLine(null));
    this.card = null;
    if (this.queueJustCleared) {
      this.queueJustCleared = false;
      this.queueRunning = false;
      const n = this.queue.streak;
      this.say(`All clear for today · ${n === 1 ? '1 day' : `${n} days`} in a row · see you tomorrow`, 'ok');
    } else if (this.queueRunning && this.offerQueue(true)) {
      return; // the next item waits for your pinch
    }
  }

  /** Your pinch on the agent card: yes (left button) or no (right). */
  private answerCard(yes: boolean): void {
    const card = this.card;
    const slot = this.plan?.slot;
    if (!card) return;
    playTick();
    if (card.kind === 'example') {
      this.card = null;
      if (yes) void this.checkCalendar();
      else if (!this.offerQueue()) this.say('Okay · pinch “Find time + draft invite” to plan your own', 'muted');
      return;
    }
    if (card.kind === 'queue') {
      this.card = null;
      const item = nextItem(this.queue);
      if (yes && item) {
        this.queueRunning = true;
        void this.ask(item.say);
      } else {
        this.queueRunning = false;
        this.say('Okay · your list stays beside the title · any chip still works', 'muted');
      }
      return;
    }
    if (card.kind === 'move') {
      this.card = null;
      const meeting = this.moveOffer;
      this.moveOffer = null;
      if (yes && meeting) {
        const plan = makeMovePlan(this.planCal(), meeting, {}, '', this.plan ?? undefined);
        this.setPlan(plan);
        this.say(plan.slot ? `Found a new time for ${meeting.title} · needs your hold` : `No other time fits ${meeting.title} this week`, plan.slot ? 'ai' : 'warn');
      } else {
        this.say('Okay · the meeting stays where it is', 'muted');
      }
      return;
    }
    if (card.kind === 'rule') {
      this.card = null;
      const offer = this.ruleOffer;
      const plan = this.plan;
      this.ruleOffer = null;
      if (!offer) return;
      this.learn = settle(yes ? this.learn : decline(this.learn, offer.key));
      writeStorage(serializeLearn(this.learn), LEARN_KEY);
      if (yes && plan) {
        this.setPlan(this.planWith(plan, mergeConstraint(plan.constraint, offer.rule)));
        this.say(`Rule added: ${offer.label} · the agent re-planned · pinch the amber area to remove it`, 'ok');
      } else {
        this.say('Okay · no rule · the agent will not ask that again', 'muted');
      }
      return;
    }
    if (card.kind === 'prep') {
      this.prep = yes && slot ? prepBlock(this.cal, slot) : null;
      this.weekKey = ''; // redraw the week with (or without) the prep block
      this.say(yes ? 'Prep block added to your calendar · 10 min before the call' : 'Okay · no prep block', yes ? 'ok' : 'muted');
    } else if (card.kind === 'remind') {
      if (yes && slot) {
        this.outbox = addToOutbox(this.outbox, reminderItem(this.cal, slot, new Date().toISOString()));
        this.board.setOutbox(this.outbox);
        this.save();
      }
      this.say(
        yes ? `Reminder for ${this.cal.guest.name} is in the demo outbox · nothing was really sent` : 'Okay · no reminder',
        yes ? 'ok' : 'muted',
      );
    }
    this.nextCard();
  }

  // ---------- when the week changes ----------

  /** The first thing on a fresh board: one evident action. */
  private firstCard(): void {
    if (!ACTIVE.real && this.outbox.length === 0 && !this.plan) {
      this.card = {
        kind: 'example',
        title: 'EXAMPLE · 30 SECONDS',
        text: 'A call was approved. Then the week changes. See how it is fixed.',
        yes: 'Try it',
        no: 'Plan my own',
        tone: 'next',
        hint: 'Pinch “Try it” to see the idea in 30 seconds',
      };
      this.cardShownAt = this.clockS;
      return;
    }
    this.offerQueue();
  }

  /** The approved item in conflict that is not being reviewed right now, if any. */
  private stale(): OutboxItem | null {
    if (this.staleOf.outbox !== this.outbox) this.staleOf = { outbox: this.outbox, item: needsReview(this.outbox) };
    return this.review ? null : this.staleOf.item;
  }

  /** What the control beside the outbox does now (null: hidden). Rebuilt only on change. */
  private calendarControl(): CalendarButtonView | null {
    const stale = this.stale();
    const reviewing = this.review !== null;
    const last = this.calendarView;
    if (last && last.reviewing === reviewing && last.stale === stale && last.refreshing === this.refreshing && last.suggest === this.suggestCalendar) {
      return last.view;
    }
    let view: CalendarButtonView | null;
    if (stale) view = { label: '⚠ Review conflict', sub: '1 approved time is blocked', primary: true };
    else if (LINKED) view = { label: this.refreshing ? 'Reading…' : '⟳ Refresh my calendar', sub: 'reads your link again', primary: false };
    else if (ACTIVE.real || this.review) view = null; // a calendar from a file is read again on the start page
    else view = { label: '⟳ Try a calendar change', sub: 'EXAMPLE · adds one busy block', primary: this.suggestCalendar };
    this.calendarView = { reviewing, stale, refreshing: this.refreshing, suggest: this.suggestCalendar, view };
    return view;
  }

  /** The control was pinched: come back to a blocked item, re-read your link, or run the example. */
  private async checkCalendar(): Promise<void> {
    if (this.busy || this.refreshing) return;
    playTick();
    const stale = this.stale();
    // One thing at a time: a review opened over a card that is still in its Unsend window would let
    // the pending send land on the wrong item.
    if (this.sendingUntil !== null && (stale || this.plan?.moving)) {
      this.say('Still sending · wait for it, or pinch the card to Unsend', 'muted');
      return;
    }
    if (stale) {
      this.beginReview({ item: stale });
      return;
    }
    if (ACTIVE.real) {
      if (LINKED) await this.refreshOwn();
      return;
    }
    if (!this.review) this.exampleChange();
  }

  /**
   * The labelled example. Snapshot B = the week on the wall plus ONE new busy block
   * on your side, over the time in play: the draft on the desk, else the newest
   * approved call, else the example's own approval (snapshot A, marked as such).
   * B is then checked exactly as a newly read calendar file is.
   */
  private exampleChange(): void {
    const plan = this.plan;
    let target: Pick<Slot, 'day' | 'start' | 'end'> | null = null;
    if (plan?.slot && plan.invite && !plan.moving && (plan.approval === 'needs' || this.sendingUntil !== null)) {
      target = plan.slot;
    } else {
      const item = this.outbox.find((o) => usable(o) && (kindOf(o) === 'call' || kindOf(o) === 'focus') && itemSlot(o) !== null);
      target = item ? itemSlot(item) : null;
    }
    if (!target) {
      const first = makePlan(this.cal).slot;
      const seed = exampleApproval(this.cal, new Date().toISOString(), first ? slotInstant(this.cal, first) : null);
      if (!seed?.plan.slot) {
        this.say('No free time is left in the sample week · reset it on the start page', 'warn');
        return;
      }
      const item: OutboxItem = { ...seed.item, id: freshId(this.outbox, seed.item.id) };
      this.outbox = addToOutbox(this.outbox, item);
      this.animateNext = false;
      this.setPlan(seed.plan, false);
      this.currentItemId = item.id;
      this.board.setOutbox(this.outbox);
      target = seed.plan.slot;
    }
    const block = exampleBlock(this.cal, target);
    this.exampleBlocks = [...this.exampleBlocks, block].slice(-EXAMPLE.maxBlocks);
    this.suggestCalendar = false;
    this.loadSnapshot(this.withKeptExamples());
  }

  /** The week with only the example blocks that are kept: older ones leave it, so the sample week never fills up. */
  private withKeptExamples(): CalendarData {
    const owner = this.cal.busy.owner.filter((b) => !isExampleBlock(b));
    return withExample({ ...this.cal, busy: { owner, guest: this.cal.busy.guest } }, this.exampleBlocks);
  }

  /** Read your linked calendar again. A failed read keeps what was known and says so. */
  private async refreshOwn(): Promise<void> {
    this.refreshing = true;
    this.say('Reading your calendar again…', 'ai');
    const result = await refreshLinked(AGENT_URL, 6000, this.fetchImpl as typeof fetch | undefined);
    this.refreshing = false;
    const next = activeCalendar();
    this.board.setSourceLabel(next.label, true);
    if (!result.tried || !result.ok) {
      this.say('Refresh failed · the wall still shows the last calendar that was read', 'warn');
      return;
    }
    this.loadSnapshot(next.cal);
    if (!this.review) this.say('Calendar read again · nothing you approved is affected', 'ok');
  }

  /** A newer calendar is known: show it, and check everything against it. */
  private loadSnapshot(cal: CalendarData): void {
    this.cal = cal;
    this.calVersion++;
    this.weekKey = '';
    this.recheck();
    this.save();
  }

  /**
   * The one check, run on every snapshot: at start (a new file or a re-read link was
   * loaded before the board), after the example change, after a refresh, and at the
   * approval boundary. Order matters: the card under the user's hand first.
   */
  private recheck(): void {
    const at = new Date().toISOString();
    let plan = this.plan;
    const rv = this.review;
    // 1. A card in its Unsend window whose time is gone: the send is stopped.
    if (plan?.slot && this.sendingUntil !== null && this.currentItemId && this.planOverlaps(plan)) {
      this.outbox = removeFromOutbox(this.outbox, this.currentItemId);
      this.currentItemId = null;
      this.sendingUntil = null;
      this.board.setOutbox(this.outbox);
      this.setPlan(unapprove(plan), false);
      plan = this.plan;
      this.say('Stopped before sending · that time is busy now', 'warn');
    }
    // 2. A draft on the desk (maybe mid-hold) whose time is gone: the hold is over.
    const draftGone = plan !== null && plan.approval === 'needs' && plan.slot !== null && this.planOverlaps(plan);
    if (draftGone) this.hold.cancel();
    // 3. Everything approved, against the newest calendar.
    const checked = revalidate(this.outbox, this.cal, at);
    if (checked.changed) {
      this.outbox = checked.outbox;
      this.board.setOutbox(this.outbox);
    }
    if (rv) {
      // Already reviewing: look for other times afresh; a trial whose time went is dropped.
      const next = refreshReview(this.planCal(), rv);
      const lostTrial = rv.trial !== null && (next.trial === null || draftGone);
      this.review = lostTrial ? { ...next, trial: null } : next;
      if (lostTrial) {
        if (this.sendingUntil !== null) this.unsend(); // a trial still in its Unsend window is pulled back first
        this.animateNext = false;
        this.setPlan(this.reviewBase, false);
        if (rv.itemId) this.currentItemId = rv.itemId;
        this.say('That time was taken too · pick again', 'alert');
      }
    } else {
      const item = needsReview(this.outbox);
      if (draftGone && plan && !plan.moving) this.beginReview({ draft: plan });
      else if (item && this.sendingUntil === null) this.beginReview({ item });
      else if (draftGone) {
        this.setPlan(null, false);
        this.say('That time is busy now · plan it again', 'warn');
      }
    }
    this.markFresh();
    if (checked.changed) this.save();
  }

  /** The busy blocks that sit on the old time are drawn as NEW on the week. */
  private markFresh(): void {
    const rv = this.review;
    if (!rv) return;
    const keys = overlapsOf(this.cal, rv.old, undefined, rv.kind === 'focus').map((o) => `${o.day}T${o.start}`);
    if (keys.some((k) => !this.fresh.has(k))) this.fresh = new Set([...this.fresh, ...keys]);
  }

  /** Start reviewing one conflict: the old card comes back to the desk, blocked. */
  private beginReview(target: { item: OutboxItem } | { draft: Plan }): void {
    const review = startReview(this.planCal(), target);
    if (!review) return;
    const item = 'item' in target ? target.item : null;
    const mine = item !== null && this.plan?.approval === 'approved' && this.currentItemId === item.id;
    const base = item ? (mine ? this.plan : planForItem(item, (this.plan?.version ?? 0) + 1)) : (target as { draft: Plan }).draft;
    if (!base) return;
    this.review = review;
    this.reviewBase = base;
    this.card = null;
    this.steps = [];
    this.queueRunning = false;
    this.moveOffer = null;
    this.ruleOffer = null;
    this.hold.cancel();
    this.animateNext = false;
    this.setPlan(base, false);
    if (item) this.currentItemId = item.id;
    this.markFresh();
    const what = review.kind === 'focus' ? 'block' : 'invite';
    this.say(
      review.candidates.length === 0
        ? `The old ${what} is blocked · no other time fits this week`
        : `The old ${what} is blocked · pinch a time below to try it`,
      'alert',
    );
    playTick();
  }

  /** Pinch a candidate: a preview at the new time. Nothing approved changes. */
  private tryCandidate(index: number): void {
    const rv = this.review;
    const cand = rv?.candidates[index];
    if (!rv || !cand || this.busy) return;
    if (rv.trial === index && this.plan?.slot?.id === cand.slot.id) return; // already on trial
    // True on trial and after the hold alike (the week's footer shows it once the review is over).
    const opts = { slot: cand.slot, by: 'you' as const, reason: `You picked ${cand.label} in place of ${whenLabel(rv.old)}.` };
    const text = ruleText(rv.rule);
    const made =
      rv.kind === 'focus'
        ? makeFocusPlan(this.cal, rv.rule, text, this.plan ?? undefined, opts)
        : makePlan(this.cal, rv.rule, text, this.plan ?? undefined, opts);
    const plan: Plan = { ...made, alternatives: [], ...(rv.itemId ? { replaces: rv.itemId } : {}) };
    this.review = { ...rv, trial: index };
    this.animateNext = false; // your own pick: no sweep, just the card flying down from that time
    this.setPlan(plan);
    this.say(`Trying ${cand.label} · nothing changes until you hold the card on your desk`, 'ai');
    playTick();
  }

  /** The review's back-out button: cancel the trial, or put the review off. Approvals are untouched. */
  private cancelReview(): void {
    const rv = this.review;
    if (!rv) return;
    playTick();
    if (rv.trial !== null) {
      if (this.sendingUntil !== null) this.unsend(); // a replacement still in its Unsend window is pulled back
      this.review = { ...rv, trial: null };
      this.animateNext = false;
      this.setPlan(this.reviewBase);
      if (rv.itemId) this.currentItemId = rv.itemId;
      this.say(`Trial cancelled · nothing was approved · ${whenLabel(rv.old)} stays blocked`, 'muted');
      return;
    }
    this.review = null;
    this.reviewBase = null;
    if (!rv.itemId) {
      this.setPlan(null);
      this.say('Draft dropped · that time is busy now', 'muted');
    } else {
      this.say('Okay · the old invite stays blocked · pinch “Review conflict” to come back', 'muted');
    }
  }

  /** In a review, what you say (or a test says) is a limit for the search. */
  private async reviewAsk(text: string, heard: string): Promise<AgentResult | null> {
    const rv = this.review;
    if (!rv) return null;
    const id = ++this.requestId;
    this.busy = true;
    this.say(heard ? `${heard} · thinking…` : 'Thinking…', 'ai');
    const t0 = performance.now();
    let got: Awaited<ReturnType<typeof understandRule>>;
    try {
      got = await understandRule(this.planCal(), text, rv.rule, { url: this.agentUrl, fetch: this.fetchImpl });
    } finally {
      if (id === this.requestId) this.busy = false;
    }
    // A late answer: a newer request won, or the review moved on. It changes nothing.
    if (id !== this.requestId || this.review !== rv) return null;
    this.lastAskMs = performance.now() - t0;
    const post = heard ? ` · ${heard}` : '';
    if (got.by === 'none') {
      this.say(`Not sure what limit you meant (${got.note}) · pinch a time, or say “after 3 PM”${post}`, 'warn');
      return null;
    }
    const before = rv.candidates.map((c) => c.slot.id).join();
    const next = refreshReview(this.planCal(), rv, got.constraint);
    const changed = next.candidates.map((c) => c.slot.id).join() !== before;
    const lostTrial = rv.trial !== null && next.trial === null;
    if (lostTrial && this.sendingUntil !== null) this.unsend();
    this.review = { ...next, heard: { text: ruleText(got.constraint) || 'any time', by: got.by, changed } };
    if (lostTrial) {
      this.animateNext = false;
      this.setPlan(this.reviewBase);
      if (rv.itemId) this.currentItemId = rv.itemId;
    }
    const who = got.by === 'ai' ? `Live AI · ${MODEL_LABEL}` : 'Rules';
    this.say(`${who} understood “${ruleText(got.constraint) || 'any time'}”${post}`, got.by === 'ai' ? 'ai' : 'warn');
    playTick();
    return null;
  }

  /** A hold in progress is cancelled from outside (tracking lost, view interrupted). */
  private cancelHold(why: string): void {
    const was = this.hold.progress > 0 || this.inviteHeld;
    this.releaseHold();
    this.hold.cancel();
    if (was) this.say(`Hold cancelled · ${why} · nothing was approved`, 'warn');
  }

  // ---------- morning queue ----------

  /** Show the queue card when something still needs your OK today. Returns whether it did. */
  private offerQueue(next = false): boolean {
    this.queue = parseQueue(serializeQueue(this.queue), today()); // a new day clears yesterday's ticks
    const item = nextItem(this.queue);
    if (!item) return false;
    const left = QUEUE.filter((q) => !this.queue.done.includes(q.id));
    const count = `${left.length} ${left.length === 1 ? 'THING NEEDS' : 'THINGS NEED'} YOUR OK`;
    this.card = {
      kind: 'queue',
      title: next ? `${this.queue.done.length} OF ${QUEUE.length} CLEARED · NEXT` : `${greeting(new Date().getHours())} · ${count} TODAY`,
      text:
        left.length > 1
          ? `First: ${left[0].label}. Then: ${left[1].label}. Each one needs your hold.`
          : `${item.label}. It needs your hold.`,
      yes: next ? 'Next' : 'Start',
      no: next ? 'Stop here' : 'Later',
      tone: 'next',
    };
    this.cardShownAt = this.clockS;
    return true;
  }

  /** A card really went out: tick its queue item; the last tick counts the day. */
  private tickQueue(task: string): void {
    const id = itemForTask(task);
    if (!id) return;
    const result = markDone(this.queue, id, today());
    this.queue = result.state;
    if (result.completed) this.queueJustCleared = true;
    writeStorage(serializeQueue(this.queue), QUEUE_KEY);
    this.board.setQueueLine(queueLine(this.queue), allClear(this.queue));
  }

  // ---------- learning from corrections ----------

  /** Re-plan the same task under a new rule (the meeting or the focus block). */
  private planWith(plan: Plan, rule: Constraint): Plan {
    const cal = this.planCal();
    if (plan.moving) return makeMovePlan(cal, plan.moving, rule, ruleText(rule), plan);
    return isFocus(plan) ? makeFocusPlan(cal, rule, ruleText(rule), plan) : makePlan(cal, rule, ruleText(rule), plan);
  }

  /** You moved the agent's own pick: remember from where to where. */
  private noteCorrection(plan: Plan, to: Slot): void {
    if (!plan.slot || plan.by === 'you' || plan.slot.id === to.id) return;
    this.learn = addCorrection(this.learn, plan.slot, to);
    writeStorage(serializeLearn(this.learn), LEARN_KEY);
  }

  /** Two corrections agree: the agent offers a rule. It never adds one by itself. */
  private offerRule(): void {
    if (this.card || !this.plan) return;
    const offer = proposeRule(this.learn, this.plan.constraint);
    if (!offer) return;
    this.ruleOffer = offer;
    this.card = {
      kind: 'rule',
      title: 'AGENT NOTICED A PATTERN',
      text: `${offer.noticed} Make "${offer.label}" a rule?`,
      yes: 'Add rule',
      no: 'No',
      tone: 'next',
    };
    this.cardShownAt = this.clockS;
    this.say('The agent has a suggestion · it needs your pinch', 'ai');
  }

  // ---------- field of view, eye gaze ----------

  /**
   * Every frame in mixed reality: learn this device's view angles, keep the board
   * inside them, point to the desk card when it is out of view, and switch the
   * hints to "look at" when eye gaze does the pointing.
   */
  private updateView(): void {
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
      this.board.setDeskHint(false);
      return;
    }
    if (!this.fovOverride) {
      const eye = this.xrManager.isPresenting ? this.xrManager.getCamera().cameras[0] : undefined;
      const m = eye?.projectionMatrix.elements;
      const fov = m ? fovFromProjection(m[0], m[5]) : null;
      if (fov && (!this.fov || Math.abs(fov.h - this.fov.h) > 0.01 || Math.abs(fov.v - this.fov.v) > 0.01)) {
        this.fov = fov;
        this.refit();
      }
    }
    const gaze = this.input.xr.gazeEnabled && this.input.xr.gazePointer.canTarget();
    if (gaze !== this.gazeOn) {
      this.gazeOn = gaze;
      this.board.setLookMode(gaze);
    }
    const plan = this.plan;
    const blockedCard = this.review !== null && this.review.trial === null;
    const waiting = plan?.invite != null && plan.approval === 'needs' && this.board.desk.visible && !this.board.sweeping && !blockedCard;
    let hint = false;
    if (waiting && this.board.object.visible) {
      const head = this.player.head;
      head.getWorldPosition(this.headPos);
      head.getWorldQuaternion(this.headQuat);
      this.headFwd.set(0, 0, -1).applyQuaternion(this.headQuat);
      hint = !inView(this.headPos, this.headFwd, this.board.desk.position, this.fov ?? DEFAULT_FOV);
    }
    this.board.setDeskHint(hint);
  }

  /** The board's size for a placement: what placement asked for, shrunk to fit the view. */
  private fittedScale(p: Placement): number {
    if (!this.fov || this.headPos.lengthSq() < 1e-6) return p.scale;
    const d = Math.hypot(p.position.x - this.headPos.x, p.position.y - this.headPos.y, p.position.z - this.headPos.z);
    return fitScale(BOARD, d, this.fov, p.scale);
  }

  /** The view angles changed (first reading, or a test override): resize the board where it is. */
  private refit(): void {
    if (!this.placed || !this.board.object.visible) return;
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    this.player.head.getWorldPosition(this.headPos);
    this.board.setScale(this.fittedScale(this.placed));
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
        (chip.id === 'task' && this.plan !== null && !isFocus(this.plan) && !this.plan.moving) ||
        (chip.id === 'focus' && isFocus(this.plan));
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
    // A different time: the prep block and pending offers belonged to the old one.
    if (plan?.slot?.id !== this.plan?.slot?.id) {
      this.prep = null;
      this.steps = [];
      this.card = null;
    }
    this.plan = plan;
    if (save) this.save();
  }

  private save(): void {
    writeStorage(serialize(this.plan, this.outbox, new Date().toISOString(), this.exampleBlocks));
    // The start page lists what you approved (email draft, calendar file): tell it something changed.
    window.dispatchEvent(new Event('agentwall:saved'));
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
    this.placed = p;
    const flat = this.world.visibilityState.value === VisibilityState.NonImmersive;
    // Field-of-view fit: a board close to you is shrunk until this device can see all of it.
    const scale = flat ? p.scale : this.fittedScale(p);
    o.scale.setScalar(scale);
    o.visible = true;
    this.board.setStatus(p.remembered ? 'same-wall' : p.kind);
    if (!flat) this.board.appear(scale);
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
    } else if (why === 'summon') {
      this.say('Board came to you · palm up any time to call it again', 'ok');
      this.speakMoment('summon');
    } else if (why === 'move') {
      this.say('Board moved · it comes back here next time', 'ok');
      this.speakMoment('moved');
    } else if (why === 'recenter') {
      if (p.remembered) this.say('Recentered · board kept on its spot', 'ok');
    } else if (p.remembered) {
      this.say('Back on your wall · same spot as last time', 'ok');
    } else if (p.kind === 'wall' && /No wall|square in front/.test(this.agentLineText)) {
      this.say('', 'muted');
    }
    // The desk decides: the invite card goes to the real table in front, or the lap.
    // A card you dragged somewhere stays there (a recenter moves the coordinates, so it starts over).
    if (why === 'recenter') this.deskUserPlaced = false;
    if (!this.deskUserPlaced) this.placeDesk(chooseDesk(this.headPos, this.headFwd, this.lastPlanes));
  }

  // ---------- grab and move ----------

  /** The eyes: the headset in mixed reality, the camera in the desktop preview. */
  private readHead(): void {
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) this.world.camera.getWorldPosition(this.headPos);
    else this.player.head.getWorldPosition(this.headPos);
  }

  private startDrag(what: 'board' | 'card', e: PointerHit): void {
    if (this.drag || !e.point || !e.pointerPosition) return;
    const obj = what === 'board' ? this.board.object : this.board.desk;
    if (!obj.visible || (what === 'card' && this.board.sweeping)) return;
    this.controller.lock(); // you are placing it yourself: no automatic moves after this
    this.moveUntil = null;
    this.hold.cancel();
    this.inviteHeld = false;
    this.readHead();
    this.dragPoint.set(e.point.x, e.point.y, e.point.z);
    this.dragOrigin.set(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
    // Where on the thing the pinch landed, in its own metres, so it does not jump under the hand.
    obj.updateWorldMatrix(true, false);
    obj.worldToLocal(this.tmp.copy(this.dragPoint));
    this.dragStart.copy(this.dragPoint);
    this.drag = {
      what,
      pointerId: e.pointerId,
      d0: this.dragPoint.distanceTo(this.dragOrigin),
      r0: this.dragOrigin.distanceTo(this.headPos),
      lx: this.tmp.x,
      ly: this.tmp.y,
      moved: false,
    };
    this.dragDirty = false;
    this.say(
      what === 'board' ? 'Moving the board · let go to place it · near a wall it snaps on' : 'Moving the card · let go to place it',
      'ai',
    );
    playTick();
  }

  private moveDrag(e: PointerHit): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId || !e.point || !e.pointerPosition) return;
    this.dragPoint.set(e.point.x, e.point.y, e.point.z);
    this.dragOrigin.set(e.pointerPosition.x, e.pointerPosition.y, e.pointerPosition.z);
    this.dragDirty = true;
  }

  /** While a grab bar is pinched: the thing follows the ray; a hand pushed away sends it farther. */
  private updateDrag(): void {
    const d = this.drag;
    if (!d || !this.dragDirty) return;
    this.dragDirty = false;
    this.readHead();
    const isBoard = d.what === 'board';
    const dist = pushPull(
      d.d0,
      d.r0,
      this.dragOrigin.distanceTo(this.headPos),
      isBoard ? DRAG.boardGain : DRAG.cardGain,
      isBoard ? DRAG.boardMin : DRAG.cardMin,
      isBoard ? DRAG.boardMax : DRAG.cardMax,
    );
    // Where the pinched point of the bar should be now.
    const target = along(this.dragOrigin, this.dragPoint, dist);
    // A tap on a bar, or a hand that only trembles, moves nothing.
    if (!d.moved) {
      if (Math.hypot(target.x - this.dragStart.x, target.y - this.dragStart.y, target.z - this.dragStart.z) < DRAG.deadZone) return;
      d.moved = true;
    }
    if (isBoard) {
      const o = this.board.object;
      const yaw = facing(target, this.headPos);
      const c = centreFromGrab(target, yaw, d.lx, d.ly, o.scale.x);
      o.position.set(c.x, c.y, c.z);
      o.rotation.set(0, yaw, 0);
      return;
    }
    // The card turns to face the eyes, leaning back when it is below them.
    const turn = faceEyes(this.headPos, target);
    this.dragYaw = turn.yaw;
    this.dragTilt = turn.tilt;
    this.dragEuler.set(-turn.tilt, turn.yaw, 0, 'YXZ');
    this.dragQuat.setFromEuler(this.dragEuler);
    const s = this.board.desk.scale.x;
    this.dragOffset.set(d.lx * s, d.ly * s, 0).applyQuaternion(this.dragQuat);
    this.board.setDeskPose(target.x - this.dragOffset.x, target.y - this.dragOffset.y, target.z - this.dragOffset.z, this.dragEuler, s);
  }

  /** The pinch opened: the board snaps to a wall it is near, or floats where it is; the card stays. */
  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dragDirty = false;
    this.dragCount++;
    if (!d.moved) {
      // Pinched but never moved: everything is where it was.
      this.say(d.what === 'board' ? 'Pinch the bar and move your hand to move the board' : 'Pinch the bar and move your hand to move the card', 'muted');
      return;
    }
    this.readHead();
    const head = { x: this.headPos.x, y: this.headPos.y, z: this.headPos.z };
    const flat = this.world.visibilityState.value === VisibilityState.NonImmersive;
    if (d.what === 'card') {
      const c = this.board.desk.position;
      const position = { x: c.x, y: c.y, z: c.z };
      this.deskUserPlaced = true;
      // It keeps the turn it had under your hand; only its size follows the new distance.
      this.placeDesk({
        kind: 'placed',
        position,
        yaw: this.dragYaw,
        tilt: this.dragTilt,
        scale: flat ? this.board.desk.scale.x : cardScale(head, position),
      });
      this.say('Card placed · it stays here · drag its bar to move it again', 'ok');
      playTick();
      return;
    }
    const o = this.board.object;
    const centre = { x: o.position.x, y: o.position.y, z: o.position.z };
    const distance = Math.hypot(centre.x - head.x, centre.y - head.y, centre.z - head.z);
    if (flat) {
      this.placed = { kind: 'fallback', position: centre, yaw: o.rotation.y, distance, scale: o.scale.x };
      this.say('Board moved', 'ok');
      return;
    }
    this.lastPlanes = this.collectPlanes();
    // Far boards are drawn larger so the text stays readable (the same rule as on a far wall).
    const scale = boardScaleFor(distance);
    const p: Placement = snapToWall(centre, head, this.lastPlanes, scale) ?? {
      kind: 'fallback',
      position: centre,
      yaw: o.rotation.y,
      distance,
      scale,
    };
    o.position.set(p.position.x, p.position.y, p.position.z);
    o.rotation.set(0, p.yaw, 0);
    this.placed = p;
    this.board.setScale(this.fittedScale(p));
    if (p.kind === 'wall') {
      this.board.setStatus('wall');
      this.rememberWall(p);
      this.say('Board is on your wall · it comes back here next time', 'ok');
    } else {
      this.board.setStatus('placed');
      this.say('Board placed · pinch and drag its bar to move it again', 'ok');
    }
    playTick();
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
    this.board.setDeskPose(d.position.x, d.position.y, d.position.z, new Euler(-d.tilt, d.yaw, 0, 'YXZ'), d.scale);
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
    this.placeDesk({ kind: 'lap', position: pos, yaw: Math.atan2(back.x, back.z), tilt: 0.2, scale: INVITE.deskScale });
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
          cand0: at(this.board.candidateButtons[0].mesh),
          cand1: at(this.board.candidateButtons[1].mesh),
          'review:cancel': at(this.board.reviewCancel.mesh),
          calendar: at(this.board.calendarButton.mesh),
          'grab:board': at(this.board.boardGrab.mesh),
          'grab:card': at(this.board.deskGrab.mesh),
          move: at(this.board.moveButton.mesh),
          voice: at(this.board.voiceButton.mesh),
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
        candHovered: this.hoveredIndex(this.candidateEntities),
        calendarHovered: this.calendarEntity.hasComponent(Hovered),
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
              scale: this.deskPlace.scale,
            }
          : null,
      drag: () => ({
        active: this.drag?.what ?? null,
        count: this.dragCount,
        cardPlacedByYou: this.deskUserPlaced,
        status: this.board.status,
      }),
      muralPoint: (dayIndex, minute) => this.board.muralPoint(dayIndex, minute),
      weekCells: () => this.currentWeek()?.cells ?? [],
      mural: () => ({
        hover: this.board.muralHoverLabel,
        pills: this.board.altRows.filter((r) => r.mesh.visible).length,
        visible: this.board.mural.mesh.visible && this.board.object.visible,
        sweeping: this.board.sweeping,
        flying: this.board.flying,
        deskNow: this.board.desk.getWorldPosition(new Vector3()).toArray(),
        ruledOut: this.week?.ruledOut ?? 0,
        fresh: this.fresh.size,
      }),
      flow: () => ({
        sendingLeft: this.sendingUntil !== null ? Math.max(0, this.sendingUntil - this.clockS) : null,
        conflict: this.inviteExtras().conflict,
        card: this.card?.kind ?? null,
        prep: this.prep !== null,
        clock: this.clockS,
        moving: this.moveUntil !== null,
        voiceOn: speechEnabled(),
        startHint: this.board.startHintVisible,
        boardScale: this.board.object.scale.x,
      }),
      recenter: () => {
        this.onReset();
      },
      setLateWallSeconds: (seconds) => {
        this.controller.lateWallSeconds = seconds;
      },
      placementAge: () => this.controller.age(this.clockS),
      setMoveSeconds: (seconds) => {
        this.moveSeconds = seconds;
      },
      setFlySlowdown: (k) => {
        this.board.flySlowdown = k;
      },
      spoken: () => this.lastSpoken,
      voiceClips: () => clipState(),
      setPalmHoldSeconds: (seconds) => {
        this.palmSummon = new PalmSummon(seconds);
      },
      palm: () => ({ hands: this.palmDebug, progress: this.palmSummon.progress, cue: this.board.palm.visible, ms: this.palmMs }),
      review: () => {
        const rv = this.review;
        return rv
          ? {
              item: rv.itemId,
              old: rv.old.id,
              reason: rv.reason,
              detail: rv.detail,
              candidates: rv.candidates.map((c) => ({ id: c.slot.id, label: c.label, why: c.why })),
              trial: rv.trial,
              heard: rv.heard,
              bar: this.board.candidateButtons.some((b) => b.mesh.visible) || this.board.reviewCancel.mesh.visible,
              chips: this.board.chipPanels.filter((c) => c.mesh.visible).length,
            }
          : null;
      },
      calendarControl: () => this.calendarControl(),
      calendarChange: () => this.checkCalendar(),
      setReducedMotion: (on) => {
        this.board.reducedMotion = on;
      },
      changeUnderHand: () => {
        const slot = this.plan?.slot;
        if (!slot) return false;
        const block = exampleBlock(this.cal, slot);
        this.exampleBlocks = [...this.exampleBlocks, block].slice(-EXAMPLE.maxBlocks);
        this.loadSnapshot(this.withKeptExamples());
        return true;
      },
      setWatch: () => {},
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
        this.review = null;
        this.reviewBase = null;
        this.exampleBlocks = [];
        this.suggestCalendar = false;
        this.card = null;
        this.steps = [];
        this.prep = null;
        this.fresh = new Set();
        this.sendingUntil = null;
        this.currentItemId = null;
        this.setPlan(null, false);
        this.board.setOutbox([]);
        this.say('', 'muted');
        writeStorage(null);
        this.wallMemory = null;
        writeStorage(null, SAME_WALL.storageKey);
        this.queue = emptyQueue(today());
        this.queueRunning = false;
        this.queueJustCleared = false;
        writeStorage(null, QUEUE_KEY);
        this.board.setQueueLine(queueLine(this.queue), false);
        this.learn = emptyLearn();
        this.ruleOffer = null;
        this.moveOffer = null;
        this.calVersion++;
        writeStorage(null, LEARN_KEY);
      },
      saved: () => readStorage(),
      calendar: () => ({ real: ACTIVE.real, label: ACTIVE.label, days: this.cal.days, busy: this.cal.busy.owner.length, guest: this.cal.guest.name }),
      queue: () => ({ ...this.queue, line: queueLine(this.queue), running: this.queueRunning }),
      learned: () => ({ ...this.learn, offer: this.ruleOffer?.key ?? null }),
      view: () => ({
        fovDeg: this.fov ? [Math.round((this.fov.h * 180) / Math.PI), Math.round((this.fov.v * 180) / Math.PI)] : null,
        scale: this.board.object.scale.x,
        asked: this.placed?.scale ?? null,
        deskHint: this.board.deskHintVisible,
        gaze: this.gazeOn,
      }),
      setFov: (hDeg, vDeg) => {
        this.fovOverride = hDeg === null ? null : fovFromDegrees(hDeg, vDeg ?? hDeg);
        this.fov = this.fovOverride;
        this.refit();
      },
      offerQueue: () => this.offerQueue(),
    };
  }
}

