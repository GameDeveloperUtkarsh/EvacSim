import { DEFAULT_FIRE, FireModel, type FireConfig } from './fire';
import { computeFlowField, NEIGHBORS } from './flowfield';
import { mulberry32, shuffle, type Rng } from './rng';
import { Cell, type FloorPlan } from './types';

export const AgentState = {
  /** Has not reacted to the alarm yet (pre-movement time). */
  Waiting: 0,
  Moving: 1,
  Evacuated: 2,
  Dead: 3,
} as const;

export interface SimConfig {
  agentCount: number;
  seed: number;
  /** Fixed time step, s. */
  dt: number;
  /** The run stops after this many simulated seconds. */
  maxTime: number;
  /** Body radius, m. */
  agentRadius: number;
  /** Walking speed range, m/s, sampled uniformly per agent. */
  speedRange: [number, number];
  /** Pre-movement time range, s: how long before an agent reacts to the alarm. */
  reactionRange: [number, number];
  /** Extra path cost per unit of smoke, so agents route around smoke when they can. */
  smokeAvoidance: number;
  /** How often routes are recomputed as hazards change, s. */
  replanInterval: number;
  /** Health lost per second in full smoke (health starts at 1). */
  smokeDamage: number;
  /** Health lost per second standing in fire. */
  fireDamage: number;
  fire: FireConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  agentCount: 200,
  seed: 1,
  dt: 0.05,
  maxTime: 600,
  agentRadius: 0.22,
  speedRange: [0.9, 1.5],
  reactionRange: [0, 15],
  smokeAvoidance: 6,
  replanInterval: 1,
  smokeDamage: 0.025,
  fireDamage: 0.6,
  fire: DEFAULT_FIRE,
};

export interface ExitInfo {
  id: number;
  label: string;
  cells: number[];
  /** Centroid in grid units. */
  cx: number;
  cy: number;
}

export interface SimMetrics {
  time: number;
  total: number;
  evacuated: number;
  dead: number;
  remaining: number;
  exitCounts: number[];
  finished: boolean;
  /** Time by which 95% of all occupants were out, or null if that never happened. */
  t95: number | null;
}

let nextId = 1;

/**
 * Grid-based crowd evacuation. Agents follow a distance-to-exit flow field, push each other apart,
 * slide along walls, and take damage from fire and smoke. Deterministic for a given seed, and free
 * of DOM dependencies so it can run headless (tests, Web Worker, what-if comparisons).
 */
export class Simulation {
  readonly id = nextId++;
  readonly plan: FloorPlan;
  readonly cfg: SimConfig;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly exits: ExitInfo[];
  /** Exit index per cell, -1 elsewhere. */
  readonly exitOf: Int16Array;
  readonly fire: FireModel;
  readonly agentCount: number;

  // Agent state as parallel arrays; positions are in grid units.
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly state: Uint8Array;
  readonly health: Float32Array;
  readonly exitTime: Float32Array;
  private readonly speed: Float32Array;
  private readonly reaction: Float32Array;

  /** Agent-seconds spent in each cell: the raw congestion heatmap. */
  readonly density: Float32Array;
  densityMax = 0;
  /** Current distance-to-exit field. */
  readonly dist: Float64Array;
  readonly exitCounts: number[];
  /** Cells where fires were started (not cells the fire later spread to). */
  readonly ignitions: number[] = [];
  time = 0;
  evacuated = 0;
  dead = 0;
  finished = false;

  private readonly rng: Rng;
  private readonly wall: Uint8Array;
  private readonly blocked: Uint8Array;
  private readonly smokeCost: Float32Array;
  private readonly radius: number;
  private readonly bucketStart: Int32Array;
  private readonly bucketFill: Int32Array;
  private readonly bucketItems: Int32Array;
  private nextReplan = 0;

  constructor(plan: FloorPlan, config: Partial<SimConfig> = {}) {
    this.plan = plan;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    const { width, height, cells, cellSize } = plan;
    const n = width * height;
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.rng = mulberry32(this.cfg.seed);
    this.radius = this.cfg.agentRadius / cellSize;

    this.wall = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.wall[i] = cells[i] === Cell.Wall ? 1 : 0;
    this.blocked = new Uint8Array(n);
    this.smokeCost = new Float32Array(n);
    this.density = new Float32Array(n);
    this.dist = new Float64Array(n);
    this.fire = new FireModel(plan, this.cfg.fire);

    const { exits, exitOf } = findExits(plan);
    this.exits = exits;
    this.exitOf = exitOf;
    this.exitCounts = exits.map(() => 0);
    this.replan();

    // Spawn on distinct reachable floor cells.
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      if (cells[i] === Cell.Floor && Number.isFinite(this.dist[i])) candidates.push(i);
    }
    shuffle(candidates, this.rng);
    const count = Math.min(this.cfg.agentCount, candidates.length);
    this.agentCount = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.state = new Uint8Array(count);
    this.health = new Float32Array(count).fill(1);
    this.exitTime = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.reaction = new Float32Array(count);
    const [vMin, vMax] = this.cfg.speedRange;
    const [rMin, rMax] = this.cfg.reactionRange;
    for (let a = 0; a < count; a++) {
      const i = candidates[a];
      const cx = i % width;
      this.x[a] = cx + 0.5 + (this.rng() - 0.5) * 0.3;
      this.y[a] = (i - cx) / width + 0.5 + (this.rng() - 0.5) * 0.3;
      this.speed[a] = (vMin + this.rng() * (vMax - vMin)) / cellSize;
      this.reaction[a] = rMin + this.rng() * (rMax - rMin);
    }

    this.bucketStart = new Int32Array(n + 1);
    this.bucketFill = new Int32Array(n);
    this.bucketItems = new Int32Array(count);
  }

  /** Start a fire at a grid cell. Returns false for walls or already-burning cells. */
  igniteAt(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return false;
    const cell = gy * this.width + gx;
    const ok = this.fire.ignite(cell);
    if (ok) {
      this.ignitions.push(cell);
      this.nextReplan = this.time; // re-route on the next step
    }
    return ok;
  }

  step(): void {
    if (this.finished) return;
    const { cfg, x, y, state, health } = this;
    const dt = cfg.dt;

    this.fire.step(dt, this.rng);
    if (this.time >= this.nextReplan) {
      this.replan();
      this.nextReplan = this.time + cfg.replanInterval;
    }
    const { smoke, burning } = this.fire;

    for (let a = 0; a < this.agentCount; a++) {
      const s = state[a];
      if (s >= AgentState.Evacuated) continue;
      const ci = this.cellOf(a);
      const sm = smoke[ci];
      health[a] -= (cfg.smokeDamage * sm + (burning[ci] ? cfg.fireDamage : 0)) * dt;
      if (health[a] <= 0) {
        health[a] = 0;
        state[a] = AgentState.Dead;
        this.dead++;
        continue;
      }
      const d = (this.density[ci] += dt);
      if (d > this.densityMax) this.densityMax = d;

      if (s === AgentState.Waiting) {
        // Smoke or flames in your own cell cut the pre-movement time short.
        if (this.time < this.reaction[a] && sm < 0.05 && !burning[ci]) continue;
        state[a] = AgentState.Moving;
      }

      const target = this.downhill(ci);
      if (target < 0) continue;
      const tx = (target % this.width) + 0.5;
      const ty = Math.floor(target / this.width) + 0.5;
      const dx = tx - x[a];
      const dy = ty - y[a];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Crowding (Weidmann fundamental diagram) and smoke (visibility) both slow people down.
      const crowd = weidmann(this.localDensity(ci));
      const stepLen = Math.min(len, this.speed[a] * crowd * (1 - 0.5 * Math.min(1, sm)) * dt);
      x[a] += (dx / len) * stepLen;
      y[a] += (dy / len) * stepLen;
    }

    this.separate();

    const exitAt = this.time + dt;
    for (let a = 0; a < this.agentCount; a++) {
      if (state[a] >= AgentState.Evacuated) continue;
      this.collideWalls(a);
      const e = this.exitOf[this.cellOf(a)];
      if (e >= 0) {
        state[a] = AgentState.Evacuated;
        this.exitTime[a] = exitAt;
        this.evacuated++;
        this.exitCounts[e]++;
      }
    }

    this.time = exitAt;
    if (this.evacuated + this.dead === this.agentCount || this.time >= cfg.maxTime) this.finished = true;
  }

  runToEnd(): SimMetrics {
    while (!this.finished) this.step();
    return this.metrics();
  }

  metrics(): SimMetrics {
    return {
      time: this.time,
      total: this.agentCount,
      evacuated: this.evacuated,
      dead: this.dead,
      remaining: this.agentCount - this.evacuated - this.dead,
      exitCounts: [...this.exitCounts],
      finished: this.finished,
      t95: this.t95(),
    };
  }

  private t95(): number | null {
    const need = Math.ceil(this.agentCount * 0.95);
    if (need === 0 || this.evacuated < need) return null;
    const times: number[] = [];
    for (let a = 0; a < this.agentCount; a++) {
      if (this.state[a] === AgentState.Evacuated) times.push(this.exitTime[a]);
    }
    times.sort((p, q) => p - q);
    return times[need - 1];
  }

  private cellOf(a: number): number {
    const gx = Math.min(this.width - 1, Math.max(0, Math.floor(this.x[a])));
    const gy = Math.min(this.height - 1, Math.max(0, Math.floor(this.y[a])));
    return gy * this.width + gx;
  }

  private replan(): void {
    const { blocked, wall, smokeCost } = this;
    const { burning, smoke } = this.fire;
    for (let i = 0; i < blocked.length; i++) {
      blocked[i] = wall[i] | burning[i];
      smokeCost[i] = smoke[i] * this.cfg.smokeAvoidance;
    }
    const targets = this.exits.flatMap((e) => e.cells);
    computeFlowField(this.width, this.height, blocked, targets, smokeCost, this.dist);
  }

  /** The neighbouring cell with the lowest distance-to-exit, or -1 if none improves on this one. */
  private downhill(ci: number): number {
    const { width: w, height: h, dist, blocked } = this;
    const x = ci % w;
    const y = (ci - x) / w;
    let best = -1;
    let bestD = dist[ci];
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (blocked[j]) continue;
      if (dx !== 0 && dy !== 0 && (blocked[y * w + nx] || blocked[ny * w + x])) continue;
      if (dist[j] < bestD) {
        bestD = dist[j];
        best = j;
      }
    }
    return best;
  }

  /** People per m² in the 3×3 cells around ci, from the buckets built at the end of the last step. */
  private localDensity(ci: number): number {
    const { width: w, height: h, bucketStart } = this;
    const x = ci % w;
    const y = (ci - x) / w;
    let count = 0;
    let cells = 0;
    for (let cy = Math.max(0, y - 1); cy <= Math.min(h - 1, y + 1); cy++) {
      for (let cx = Math.max(0, x - 1); cx <= Math.min(w - 1, x + 1); cx++) {
        const c = cy * w + cx;
        if (this.wall[c]) continue;
        count += bucketStart[c + 1] - bucketStart[c];
        cells++;
      }
    }
    return count / (cells * this.cellSize * this.cellSize);
  }

  /** Push overlapping agents apart, using a per-cell bucket grid for neighbour lookup. */
  private separate(): void {
    const { width: w, height: h, x, y, state, bucketStart, bucketFill, bucketItems } = this;
    const active = (a: number) => state[a] < AgentState.Evacuated;

    bucketStart.fill(0);
    for (let a = 0; a < this.agentCount; a++) if (active(a)) bucketStart[this.cellOf(a) + 1]++;
    for (let c = 0; c < w * h; c++) bucketStart[c + 1] += bucketStart[c];
    bucketFill.set(bucketStart.subarray(0, w * h));
    for (let a = 0; a < this.agentCount; a++) if (active(a)) bucketItems[bucketFill[this.cellOf(a)]++] = a;

    const minD = 2 * this.radius;
    const minD2 = minD * minD;
    for (let a = 0; a < this.agentCount; a++) {
      if (!active(a)) continue;
      const gx = Math.floor(x[a]);
      const gy = Math.floor(y[a]);
      for (let cy = gy - 1; cy <= gy + 1; cy++) {
        if (cy < 0 || cy >= h) continue;
        for (let cx = gx - 1; cx <= gx + 1; cx++) {
          if (cx < 0 || cx >= w) continue;
          const c = cy * w + cx;
          for (let k = bucketStart[c]; k < bucketStart[c + 1]; k++) {
            const b = bucketItems[k];
            if (b <= a) continue;
            let dx = x[b] - x[a];
            let dy = y[b] - y[a];
            let d2 = dx * dx + dy * dy;
            if (d2 >= minD2) continue;
            if (d2 < 1e-12) {
              dx = 1e-3;
              dy = 0;
              d2 = 1e-6;
            }
            const d = Math.sqrt(d2);
            const push = (minD - d) * 0.25;
            x[a] -= (dx / d) * push;
            y[a] -= (dy / d) * push;
            x[b] += (dx / d) * push;
            y[b] += (dy / d) * push;
          }
        }
      }
    }
  }

  /** Resolve circle-vs-wall-cell overlap so agents slide along walls instead of passing through. */
  private collideWalls(a: number): void {
    const { width: w, height: h, wall, radius: r } = this;
    let px = this.x[a];
    let py = this.y[a];
    const gx = Math.floor(px);
    const gy = Math.floor(py);
    for (let cy = gy - 1; cy <= gy + 1; cy++) {
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        const solid = cx < 0 || cy < 0 || cx >= w || cy >= h || wall[cy * w + cx] === 1;
        if (!solid) continue;
        const qx = Math.max(cx, Math.min(px, cx + 1));
        const qy = Math.max(cy, Math.min(py, cy + 1));
        const dx = px - qx;
        const dy = py - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d);
          py += (dy / d) * (r - d);
        } else {
          // Centre is inside the wall cell: eject through the nearest face.
          const left = px - cx;
          const right = cx + 1 - px;
          const top = py - cy;
          const bottom = cy + 1 - py;
          const m = Math.min(left, right, top, bottom);
          if (m === left) px = cx - r;
          else if (m === right) px = cx + 1 + r;
          else if (m === top) py = cy - r;
          else py = cy + 1 + r;
        }
      }
    }
    this.x[a] = px;
    this.y[a] = py;
  }
}

/**
 * Weidmann (1993) speed–density relation as a fraction of free walking speed: ~1 when sparse,
 * falling to 0 at the jam density of 5.4 people/m². Floored so dense crowds still creep forward.
 */
function weidmann(density: number): number {
  if (density <= 0) return 1;
  return Math.max(0.08, 1 - Math.exp(-1.913 * (1 / density - 1 / 5.4)));
}

/** Group exit cells into connected exits and name them by the wall they sit on. */
function findExits(plan: FloorPlan): { exits: ExitInfo[]; exitOf: Int16Array } {
  const { width: w, height: h, cells } = plan;
  const exitOf = new Int16Array(w * h).fill(-1);
  const exits: ExitInfo[] = [];
  for (let start = 0; start < w * h; start++) {
    if (cells[start] !== Cell.Exit || exitOf[start] !== -1) continue;
    const id = exits.length;
    const group: number[] = [];
    const stack = [start];
    exitOf[start] = id;
    while (stack.length > 0) {
      const i = stack.pop()!;
      group.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && cells[j] === Cell.Exit && exitOf[j] === -1) {
          exitOf[j] = id;
          stack.push(j);
        }
      }
    }
    let sx = 0;
    let sy = 0;
    for (const i of group) {
      sx += (i % w) + 0.5;
      sy += Math.floor(i / w) + 0.5;
    }
    const cx = sx / group.length;
    const cy = sy / group.length;
    exits.push({ id, label: sideLabel(cx, cy, w, h), cells: group, cx, cy });
  }

  const totals = new Map<string, number>();
  for (const e of exits) totals.set(e.label, (totals.get(e.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const e of exits) {
    if (totals.get(e.label)! > 1) {
      const k = (seen.get(e.label) ?? 0) + 1;
      seen.set(e.label, k);
      e.label = `${e.label} ${k}`;
    }
  }
  return { exits, exitOf };
}

function sideLabel(cx: number, cy: number, w: number, h: number): string {
  const sides: [number, string][] = [
    [cy, 'North'],
    [h - cy, 'South'],
    [cx, 'West'],
    [w - cx, 'East'],
  ];
  sides.sort((p, q) => p[0] - q[0]);
  return `${sides[0][1]} exit`;
}
