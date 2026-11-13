/**
 * Places the board on a detected wall, or 1.2 m in front of the user when no
 * wall is found. The decisions live in ./logic (plain TS, unit-tested); this
 * system only copies XR data in and moves the board.
 */
import {
  createSystem,
  Quaternion,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { Board } from './board.js';
import calendarJson from './data/sample-calendar.json';
import { PlacementController } from './logic/placement-controller.js';
import { fallbackPlacement, type PlaneInput, type Placement } from './logic/placement.js';
import { chooseSlot, isLinked, makePlan, type Plan } from './logic/plan.js';
import type { CalendarData } from './logic/scheduler.js';

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
  /** Test hook until drag exists (Day 3): use alternative i as the slot. */
  pickAlternative: (i: number) => void;
  cards: () => Array<{ name: string; visible: boolean }>;
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
  private lastPlanes: PlaneInput[] = [];
  private noPlanes = false;
  private plan: Plan | null = null;

  init(): void {
    this.board = new Board(calendar);
    this.world.createTransformEntity(this.board.object);

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
        return {
          position: o.position.toArray(),
          yaw: o.rotation.y,
          visible: o.visible,
        };
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
      pickAlternative: (i) => {
        const alt = this.plan?.alternatives[i];
        if (this.plan && alt) this.setPlan(chooseSlot(calendar, this.plan, alt));
      },
    };
  }

  update(_delta: number, time: number): void {
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;

    if (this.pendingStart) {
      this.pendingStart = false;
      this.controller.start(time);
    }
    if (this.controller.state === 'idle' || this.controller.state === 'wall') return;

    // Head pose in world space.
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
        orientation: {
          x: obj.quaternion.x,
          y: obj.quaternion.y,
          z: obj.quaternion.z,
          w: obj.quaternion.w,
        },
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
    // Day 2: the agent runs the demo task as soon as there is a board.
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
    const p = fallbackPlacement(this.headPos, this.headFwd);
    this.apply(p);
    this.board.setStatus('preview');
  }
}
