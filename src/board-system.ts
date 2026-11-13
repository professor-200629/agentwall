/**
 * Places the board on a detected wall (or 1.2 m in front of the user), runs
 * the agent's plan, and handles pinches:
 *
 * - pinch and hold the invite for 1 s -> approved, flies into the demo outbox
 * - pinch an "Also free" row -> that slot is used; the invite rewrites itself
 *   and needs approval again
 *
 * The decisions live in ./logic (plain TS, unit-tested); this system copies
 * XR state in, calls the logic, and tells the Board what to draw.
 *
 * Pinch input comes from IWSDK's RayInteractable: a hand ray (or the mouse in
 * the desktop preview) pointing at an entity adds Hovered; pinching adds
 * Pressed.
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
import calendarJson from './data/sample-calendar.json';
import { HOLD, HoldToApprove } from './logic/hold.js';
import { PlacementController } from './logic/placement-controller.js';
import { fallbackPlacement, type PlaneInput, type Placement } from './logic/placement.js';
import {
  addToOutbox,
  approve,
  chooseSlot,
  isLinked,
  makePlan,
  type OutboxItem,
  type Plan,
} from './logic/plan.js';
import type { CalendarData } from './logic/scheduler.js';
import { playApproved, playTick } from './ui/sound.js';

const calendar = calendarJson as CalendarData;

/** The fields of a WebXR XRPlane we read. */
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
  /** Test hook until chips/voice exist (Day 4): rule "only after H o'clock", or null to clear. */
  setAfter: (hour: number | null, text?: string) => void;
  cards: () => Array<{ name: string; visible: boolean }>;
  /** World positions of the pinchable targets, for aiming in the emulator. */
  targets: () => Record<string, number[]>;
  interaction: () => {
    hold: number;
    inviteHovered: boolean;
    invitePressed: boolean;
    altHovered: number | null;
    /** Highest ring progress seen since the last resetDemo (proves the ring filled). */
    peakHold: number;
  };
  outbox: () => OutboxItem[];
  /** Test hook: make the hold longer so a screenshot can catch the ring mid-fill. */
  setHoldSeconds: (seconds: number) => void;
  /** Test hook: clear the outbox and start a fresh plan. */
  resetDemo: () => void;
}

declare global {
  interface Window {
    agentwall?: AgentWallDebug;
  }
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
  private altWasPressed: boolean[] = [];
  private holdPlanVersion = -1;
  private peakHold = 0;

  init(): void {
    this.board = new Board(calendar);
    const boardEntity = this.world.createTransformEntity(this.board.object);
    this.inviteEntity = this.world.createTransformEntity(this.board.inviteCard.mesh, { parent: boardEntity });
    this.inviteEntity.addComponent(RayInteractable);
    this.altEntities = this.board.altRows.map((row) => {
      const e = this.world.createTransformEntity(row.mesh, { parent: boardEntity });
      e.addComponent(RayInteractable);
      return e;
    });
    this.altWasPressed = this.altEntities.map(() => false);

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.NonImmersive) {
          this.controller.stop();
          this.pendingStart = false;
          this.showDesktopPreview();
        } else if (this.controller.state === 'idle') {
          // Entered XR: start searching on the next frame, with its clock.
          this.pendingStart = true;
          this.board.object.visible = false;
          this.board.setStatus('searching');
        }
      }),
    );

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
      simulateNoPlanes: (on: boolean) => {
        this.noPlanes = on;
      },
      plan: () => (this.plan ? { ...this.plan, linked: isLinked(this.plan) } : null),
      setAfter: (hour, text) => {
        const constraint = hour === null ? {} : { after: hour * 60 };
        this.setPlan(makePlan(calendar, constraint, text ?? '', this.plan ?? undefined));
      },
      cards: () =>
        [this.board.slotCard, this.board.inviteCard].map((c) => ({
          name: c.mesh.name,
          visible: c.mesh.visible && this.board.object.visible,
        })),
      targets: () => {
        const at = (o: { getWorldPosition: (v: Vector3) => Vector3 }) => o.getWorldPosition(this.tmp).toArray();
        return {
          invite: at(this.board.inviteCard.mesh),
          alt0: at(this.board.altRows[0].mesh),
          alt1: at(this.board.altRows[1].mesh),
        };
      },
      interaction: () => ({
        hold: this.hold.progress,
        inviteHovered: this.inviteEntity.hasComponent(Hovered),
        invitePressed: this.inviteEntity.hasComponent(Pressed),
        altHovered: this.hoveredAlt(),
        peakHold: this.peakHold,
      }),
      outbox: () => this.outbox,
      setHoldSeconds: (seconds) => {
        this.hold = new HoldToApprove({ ...HOLD, seconds });
      },
      resetDemo: () => {
        this.peakHold = 0;
        this.outbox = [];
        this.board.setOutbox(this.outbox);
        this.setPlan(makePlan(calendar));
      },
    };
  }

  update(delta: number, time: number): void {
    this.updateInteraction(delta);
    this.board.tick(delta, time);
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    this.updatePlacement(time);
  }

  // ---------- pinches ----------

  private hoveredAlt(): number | null {
    const i = this.altEntities.findIndex((e) => e.hasComponent(Hovered));
    return i < 0 ? null : i;
  }

  private updateInteraction(delta: number): void {
    const plan = this.plan;
    const live = plan !== null && this.board.object.visible;

    // Pinch an "Also free" row: use that slot (on the press, not every frame).
    this.altEntities.forEach((e, i) => {
      const pressed = e.hasComponent(Pressed);
      if (pressed && !this.altWasPressed[i] && live && plan.alternatives[i]) {
        this.setPlan(chooseSlot(calendar, plan, plan.alternatives[i]));
        playTick();
      }
      this.altWasPressed[i] = pressed;
    });

    // Pinch and hold the invite: approve.
    const current = this.plan;
    if (current && current.version !== this.holdPlanVersion) {
      // The invite changed under the user's fingers: start the hold again.
      this.hold.reset();
      this.holdPlanVersion = current.version;
    }
    const canApprove = live && current?.invite != null && current.approval === 'needs';
    const event = this.hold.update(delta, this.inviteEntity.hasComponent(Pressed), canApprove);
    if (event === 'complete' && current) {
      const result = approve(current, new Date().toISOString());
      if (result) {
        this.outbox = addToOutbox(this.outbox, result.item);
        this.setPlan(result.plan);
        this.holdPlanVersion = result.plan.version;
        this.board.setOutbox(this.outbox);
        this.board.celebrate();
        playApproved();
      }
    }
    this.peakHold = Math.max(this.peakHold, this.hold.progress);
    this.board.setHold(this.hold.progress);
    this.board.setHover(canApprove && this.inviteEntity.hasComponent(Hovered), this.hoveredAlt());
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
    // Wait until the headset reports a real pose (not the origin).
    if (this.headPos.lengthSq() < 1e-6) return;

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
    o.visible = true;
    this.board.setStatus(p.kind);
    // For now the agent runs the demo task as soon as there is a board.
    // Day 4 replaces this with the preset chip / voice request.
    if (!this.plan) this.setPlan(makePlan(calendar));
  }

  private setPlan(plan: Plan): void {
    this.plan = plan;
    this.board.setPlan(plan);
  }

  /** On a desktop browser, show the board in front of the 2D camera. */
  private showDesktopPreview(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(this.headPos);
    cam.getWorldDirection(this.headFwd); // cameras look down -Z; this already returns it
    this.apply(fallbackPlacement(this.headPos, this.headFwd));
    this.board.setStatus('preview');
  }
}
