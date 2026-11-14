/**
 * Agent Wall's main system.
 *
 * - Places the board on a detected wall (or 1.2 m in front of the user).
 * - Asking: pinch a preset chip, or pinch 🎤 Speak and talk. The words go to
 *   the AI through our Worker; if it is slow (>3 s), offline or wrong, the
 *   rules plan instead and the board says so.
 * - Changing: pinch an "Also free" row to use that time.
 * - Approving: pinch and hold the invite for 1 s -> demo outbox.
 * - Saving: the plan and outbox are kept in localStorage.
 *
 * Decisions live in ./logic (plain TS, unit-tested). Pinch input comes from
 * IWSDK RayInteractable: a hand ray (or the mouse in the desktop preview)
 * adds Hovered; pinching adds Pressed.
 */
import {
  createSystem,
  Hovered,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { Board } from './board.js';
import { CHIPS } from './chips.js';
import calendarJson from './data/sample-calendar.json';
import { runAgent, type AgentResult, type FetchLike } from './logic/agent.js';
import { HOLD, HoldToApprove } from './logic/hold.js';
import { PlacementController } from './logic/placement-controller.js';
import { fallbackPlacement, type PlaneInput, type Placement } from './logic/placement.js';
import { addToOutbox, approve, chooseSlot, isLinked, type OutboxItem, type Plan } from './logic/plan.js';
import { parseRequest } from './logic/request.js';
import type { CalendarData } from './logic/scheduler.js';
import { restore, serialize, STORAGE_KEY } from './logic/storage.js';
import { playApproved, playTick, unlockAudio } from './ui/sound.js';
import { VoiceInput } from './voice.js';

const calendar = calendarJson as CalendarData;
/** The Worker URL is set at build time (GitHub Actions variable). Empty = rules only. */
const AGENT_URL: string = String(import.meta.env.VITE_AGENT_URL ?? '').trim();
const MODEL_LABEL = 'Groq';
/** Each chip's rule, parsed once (not every frame). */
const CHIP_RULES = CHIPS.map((c) => parseRequest(c.say, calendar).rule);

/** An Object3D as IWSDK's pointer system (@pmndrs/pointer-events) sees it. */
interface PointerTarget {
  addEventListener(type: 'pointerdown' | 'pointerup', listener: (e: { pointerId: number }) => void): void;
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

interface NativePlane {
  orientation?: 'horizontal' | 'vertical';
  semanticLabel?: string;
  polygon: ReadonlyArray<{ x: number; z: number }>;
}

export interface AgentWallDebug {
  state: () => string;
  placement: () => Placement | null;
  board: () => { position: number[]; yaw: number; visible: boolean };
  planes: () => Array<{ id: number; vertical: boolean; label?: string; position: number[] }>;
  restart: () => void;
  /** Test hook: pretend the device reports no planes (like a Quest without Space Setup). */
  simulateNoPlanes: (on: boolean) => void;
  plan: () => (Plan & { linked: boolean }) | null;
  cards: () => Array<{ name: string; visible: boolean }>;
  /** World positions of the pinchable targets, for aiming in the emulator. */
  targets: () => Record<string, number[]>;
  interaction: () => {
    hold: number;
    inviteHovered: boolean;
    invitePressed: boolean;
    altHovered: number | null;
    peakHold: number;
    busy: boolean;
    agentLine: string;
    lastAskMs: number;
  };
  outbox: () => OutboxItem[];
  /** Test hook: what the mic would have heard (the emulator has no microphone). */
  heard: (text: string) => Promise<void>;
  /** Test hook: point the agent at a fake AI: an answer object, 'offline', or null to undo. */
  fakeAi: (answer: unknown, delayMs?: number) => void;
  /** Test hook: make the hold longer so a screenshot can catch the ring mid-fill. */
  setHoldSeconds: (seconds: number) => void;
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

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(json: string | null): void {
  try {
    if (json === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Private mode or storage blocked: the board still works, it just won't be remembered.
  }
}

function savedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export class BoardSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private board!: Board;
  private controller = new PlacementController();
  private pendingStart = false;
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private headFwd = new Vector3();
  private tmp = new Vector3();
  private lastPlanes: PlaneInput[] = [];
  private noPlanes = false;
  private plan: Plan | null = null;
  private outbox: OutboxItem[] = [];
  private hold = new HoldToApprove();
  private inviteEntity!: Entity;
  private altEntities: Entity[] = [];
  private chipEntities: Entity[] = [];
  /**
   * Presses on chips and "Also free" rows, collected from pointerdown events.
   * A fast click can press and release between two frames, so polling the
   * Pressed tag could miss it; the event never does.
   */
  private presses: Array<{ kind: 'chip' | 'alt'; index: number }> = [];
  private holdPlanVersion = -1;
  private peakHold = 0;
  private busy = false;
  private requestId = 0;
  private agentLineText = '';
  /** How long the last request took, ms (AI or fallback). */
  private lastAskMs = 0;
  private voice!: VoiceInput;
  private agentUrl = AGENT_URL;
  private fetchImpl: FetchLike | undefined;

  init(): void {
    this.board = new Board(calendar);
    const boardEntity = this.world.createTransformEntity(this.board.object);
    const interactive = (mesh: Parameters<typeof this.world.createTransformEntity>[0]) => {
      const e = this.world.createTransformEntity(mesh, { parent: boardEntity });
      e.addComponent(RayInteractable);
      return e;
    };
    this.inviteEntity = interactive(this.board.inviteCard.mesh);
    this.altEntities = this.board.altRows.map((row) => interactive(row.mesh));
    this.chipEntities = this.board.chipPanels.map((chip) => interactive(chip.mesh));
    // IWSDK's pointer system dispatches pointer events on the Object3D itself.
    const onPress = (mesh: unknown, kind: 'chip' | 'alt', index: number) =>
      (mesh as PointerTarget).addEventListener('pointerdown', () => this.presses.push({ kind, index }));
    this.board.chipPanels.forEach((chip, i) => onPress(chip.mesh, 'chip', i));
    this.board.altRows.forEach((row, i) => onPress(row.mesh, 'alt', i));
    // Pinch-and-hold: capture the pointer on the invite so a hand ray that drifts off
    // the card mid-hold keeps it pressed (without capture IWSDK drops Pressed on
    // pointer-leave and only re-adds it on a new pinch; code review 14 Nov).
    const invite = this.board.inviteCard.mesh as unknown as PointerTarget;
    invite.addEventListener('pointerdown', (e) => invite.setPointerCapture(e.pointerId));
    invite.addEventListener('pointerup', (e) => invite.releasePointerCapture(e.pointerId));

    this.voice = new VoiceInput(
      this.agentUrl,
      (text) => void this.ask(text, `Heard: “${text}”`),
      (message) => this.say(message, 'warn'),
      () => this.drawChips(),
    );

    // Yesterday's board, if there is one.
    const saved = restore(readStorage(), calendar);
    if (saved) {
      this.outbox = saved.outbox;
      if (saved.plan) this.setPlan(saved.plan, false);
      this.say(`Welcome back · board saved ${savedLabel(saved.savedAt)}`, 'ok');
    } else if (!this.agentUrl) {
      this.say('Rules mode (AI not connected)', 'muted');
    }
    this.board.setOutbox(this.outbox);

    // A judge may enter through Quest Browser's own Enter button, which never clicks our
    // page, so sound would stay locked. XR select (pinch) events count as a user
    // gesture: unlock audio on the first pinch of each session (code review 14 Nov).
    const onSessionStart = () => {
      const session = this.xrManager.getSession();
      session?.addEventListener('selectstart', unlockAudio, { once: true });
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
          this.board.setStatus('searching');
        }
      }),
    );

    this.installDebugHooks();
  }

  update(delta: number, time: number): void {
    this.voice.tick();
    this.updateInteraction(delta);
    this.drawChips();
    this.board.tick(delta, time);
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    this.updatePlacement(time);
  }

  private say(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok'): void {
    this.agentLineText = text;
    this.board.setAgentLine(text, tone);
  }

  // ---------- asking the agent ----------

  /** Chips, voice and test hooks all come through here. */
  private async ask(text: string, heard = ''): Promise<void> {
    const id = ++this.requestId;
    this.busy = true;
    this.say(heard ? `${heard} · thinking…` : 'Thinking…', 'ai');
    const t0 = performance.now();
    let result: AgentResult;
    try {
      result = await runAgent(calendar, text, this.plan, { url: this.agentUrl, fetch: this.fetchImpl });
    } finally {
      if (id === this.requestId) this.busy = false;
    }
    if (id !== this.requestId) return; // a newer request won
    this.lastAskMs = performance.now() - t0;
    // Result first, then what was heard: the line is trimmed from the end when long,
    // so the attribution must never be the part that gets cut (code review 14 Nov).
    const post = heard ? ` · ${heard}` : '';
    if (!result.plan) {
      this.say(heard ? `Not sure what you meant; try a chip · ${heard}` : 'Not sure what you meant', 'warn');
      return;
    }
    this.setPlan(result.plan);
    playTick();
    if (result.by === 'ai' && !result.note) this.say(`Planned by AI · ${MODEL_LABEL}${post}`, 'ai');
    else if (result.by === 'ai') {
      // Short, calm wording: the rules double-checking the AI is a feature, not an error.
      const fixed = /did not fit/.test(result.note) ? 'rules corrected the time' : 'email from template';
      this.say(`Planned by AI · ${fixed}${post}`, 'ai');
    }
    else this.say(`${result.note ? `Rules · ${result.note.replace(/; rules planned this$/, '')}` : 'Planned by rules'}${post}`, 'warn');
  }

  // ---------- pinches ----------

  private hoveredIndex(list: Entity[]): number | null {
    const i = list.findIndex((e) => e.hasComponent(Hovered));
    return i < 0 ? null : i;
  }

  private updateInteraction(delta: number): void {
    const live = this.board.object.visible;

    // Chips and "Also free" rows, in the order they were pressed.
    for (const press of this.presses.splice(0)) {
      if (!live) continue;
      this.controller.lock(); // the user is using the board: no more jumping
      if (press.kind === 'chip') {
        const chip = CHIPS[press.index];
        if (chip.id === 'mic') void this.voice.toggle();
        else if (!this.busy) void this.ask(chip.say);
        continue;
      }
      const plan = this.plan;
      const alt = plan?.alternatives[press.index];
      if (plan && alt && !this.busy) {
        this.setPlan(chooseSlot(calendar, plan, alt));
        this.say('You picked this time', 'muted');
        playTick();
      }
    }

    // Invite: pinch and hold to approve.
    const current = this.plan;
    if (current && current.version !== this.holdPlanVersion) {
      this.hold.reset(); // the invite changed under the user's fingers
      this.holdPlanVersion = current.version;
    }
    const canApprove = live && !this.busy && current?.invite != null && current.approval === 'needs';
    if (this.inviteEntity.hasComponent(Pressed)) this.controller.lock();
    const event = this.hold.update(delta, this.inviteEntity.hasComponent(Pressed), canApprove);
    if (event === 'complete' && current) {
      const result = approve(current, new Date().toISOString());
      if (result) {
        this.outbox = addToOutbox(this.outbox, result.item);
        this.board.setOutbox(this.outbox);
        this.setPlan(result.plan);
        this.holdPlanVersion = result.plan.version;
        this.board.celebrate();
        this.say('Approved · in the demo outbox, nothing sent', 'ok');
        playApproved();
      }
    }
    this.peakHold = Math.max(this.peakHold, this.hold.progress);
    this.board.setHold(this.hold.progress);
    this.board.setHover(canApprove && this.inviteEntity.hasComponent(Hovered), this.hoveredIndex(this.altEntities));
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
    this.plan = plan;
    this.board.setPlan(plan);
    if (save) this.save();
  }

  private save(): void {
    writeStorage(serialize(this.plan, this.outbox, new Date().toISOString()));
  }

  // ---------- placement ----------

  private updatePlacement(time: number): void {
    if (this.pendingStart) {
      this.pendingStart = false;
      this.controller.start(time);
    }
    if (this.controller.state === 'idle' || this.controller.state === 'wall') return;
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
    this.board.setStatus(p.kind);
    if (p.kind === 'fallback' && this.world.visibilityState.value !== VisibilityState.NonImmersive) {
      this.say('No wall found · run Space Setup in Quest settings to pin the board to a wall', 'warn');
    } else if (p.kind === 'wall' && /No wall found/.test(this.agentLineText)) {
      this.say('', 'muted');
    }
  }

  private showDesktopPreview(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.headPos);
    cam.getWorldDirection(this.headFwd); // cameras look down -Z; this already returns it
    this.apply(fallbackPlacement(this.headPos, this.headFwd));
    this.board.setStatus('preview');
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
      plan: () => (this.plan ? { ...this.plan, linked: isLinked(this.plan) } : null),
      cards: () =>
        [this.board.slotCard, this.board.inviteCard].map((c) => ({
          name: c.mesh.name,
          visible: c.mesh.visible && this.board.object.visible,
        })),
      targets: () => {
        const t: Record<string, number[]> = {
          invite: at(this.board.inviteCard.mesh),
          alt0: at(this.board.altRows[0].mesh),
          alt1: at(this.board.altRows[1].mesh),
        };
        CHIPS.forEach((c, i) => (t[`chip:${c.id}`] = at(this.board.chipPanels[i].mesh)));
        return t;
      },
      interaction: () => ({
        hold: this.hold.progress,
        inviteHovered: this.inviteEntity.hasComponent(Hovered),
        invitePressed: this.inviteEntity.hasComponent(Pressed),
        altHovered: this.hoveredIndex(this.altEntities),
        peakHold: this.peakHold,
        busy: this.busy,
        agentLine: this.agentLineText,
        lastAskMs: Math.round(this.lastAskMs),
      }),
      outbox: () => this.outbox,
      heard: (text) => this.ask(text, `Heard: “${text}”`),
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
      resetDemo: () => {
        this.requestId++;
        this.busy = false;
        this.peakHold = 0;
        this.outbox = [];
        this.setPlan(null, false);
        this.board.setOutbox([]);
        this.say('', 'muted');
        writeStorage(null);
      },
      saved: () => readStorage(),
    };
  }
}
