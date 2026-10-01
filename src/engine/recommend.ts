import { computeFlowField } from './flowfield';
import { AgentState, Simulation, type SimConfig } from './simulation';
import { Cell, type CellType, type FloorPlan } from './types';

/** What to test fixes against: the same people (seeds) and the same fire starts for every variant. */
export interface Scenario {
  agentCount: number;
  seeds: number[];
  /** Cell indices where fires start at t = 0. */
  fires: number[];
  config?: Partial<SimConfig>;
}

/** Results averaged over the scenario's seeds. */
export interface RunSummary {
  total: number;
  evacuated: number;
  deaths: number;
  /** Mean time for 95% to get out, or null if any run never reached 95%. */
  t95: number | null;
  /** Mean exit time of those who got out. */
  meanEvacTime: number;
}

export type FixKind = 'add-exit' | 'widen-exit' | 'widen-door';

export interface Candidate {
  id: string;
  kind: FixKind;
  title: string;
  detail: string;
  /** Cells this fix changes (for highlighting). */
  cells: number[];
  plan: FloorPlan;
}

export interface Recommendation extends Candidate {
  result: RunSummary;
  livesSaved: number;
  /** Reduction in t95, when both baseline and fix reach 95% evacuated. */
  secondsSaved: number | null;
  /** Ranking score: lives first, then time. */
  score: number;
}

export interface RecommendResult {
  baseline: RunSummary;
  recommendations: Recommendation[];
}

export type Progress = (done: number, total: number) => void;

const EXIT_WIDTH_M = 2;
const MAX_NEW_EXITS = 3;
const MAX_DOORS = 2;

/** Run the scenario on a plan once per seed; returns the average plus summed congestion. */
export function evaluate(
  plan: FloorPlan,
  scenario: Scenario,
  onRun?: () => void,
): { summary: RunSummary; density: Float32Array; exitLabels: string[] } {
  const density = new Float32Array(plan.width * plan.height);
  let evacuated = 0;
  let deaths = 0;
  let total = 0;
  let t95Sum = 0;
  let t95Missing = false;
  let evacTimeSum = 0;
  let exitLabels: string[] = [];
  for (const seed of scenario.seeds) {
    const sim = new Simulation(plan, { ...scenario.config, agentCount: scenario.agentCount, seed });
    for (const cell of scenario.fires) sim.igniteAt(cell % plan.width, Math.floor(cell / plan.width));
    const m = sim.runToEnd();
    exitLabels = sim.exits.map((e) => e.label);
    total += m.total;
    evacuated += m.evacuated;
    deaths += m.dead;
    if (m.t95 === null) t95Missing = true;
    else t95Sum += m.t95;
    let sum = 0;
    for (let a = 0; a < sim.agentCount; a++) if (sim.state[a] === AgentState.Evacuated) sum += sim.exitTime[a];
    evacTimeSum += m.evacuated ? sum / m.evacuated : 0;
    for (let i = 0; i < density.length; i++) density[i] += sim.density[i];
    onRun?.();
  }
  const n = scenario.seeds.length;
  return {
    summary: {
      total: total / n,
      evacuated: evacuated / n,
      deaths: deaths / n,
      t95: t95Missing ? null : t95Sum / n,
      meanEvacTime: evacTimeSum / n,
    },
    density,
    exitLabels,
  };
}

/**
 * Find and test candidate fixes for a plan under a scenario. Every candidate is re-simulated with the same
 * seeds and fire starts as the baseline, so differences come from the building change alone.
 */
export function recommend(plan: FloorPlan, scenario: Scenario, onProgress?: Progress): RecommendResult {
  let done = 0;
  let total = scenario.seeds.length * (1 + MAX_NEW_EXITS + 4 + MAX_DOORS); // refined below
  const tick = () => onProgress?.(++done, total);

  const base = evaluate(plan, scenario, tick);
  const candidates = generateCandidates(plan, scenario, base.density, base.exitLabels);
  total = scenario.seeds.length * (1 + candidates.length);
  onProgress?.(done, total);

  const recommendations = candidates.map((c): Recommendation => {
    const { summary } = evaluate(c.plan, scenario, tick);
    const livesSaved = base.summary.deaths - summary.deaths;
    const secondsSaved =
      base.summary.t95 !== null && summary.t95 !== null ? base.summary.t95 - summary.t95 : null;
    const timeGain = secondsSaved ?? base.summary.meanEvacTime - summary.meanEvacTime;
    return { ...c, result: summary, livesSaved, secondsSaved, score: livesSaved * 100 + timeGain };
  });
  recommendations.sort((a, b) => b.score - a.score);
  return { baseline: base.summary, recommendations };
}

export function generateCandidates(
  plan: FloorPlan,
  scenario: Scenario,
  density: Float32Array,
  exitLabels: string[],
): Candidate[] {
  return [
    ...newExitCandidates(plan, scenario),
    ...widenExitCandidates(plan, exitLabels),
    ...widenDoorCandidates(plan, density),
  ];
}

// ---------------------------------------------------------------- candidate generators

const SIDES = ['north', 'south', 'west', 'east'] as const;
type Side = (typeof SIDES)[number];

/** Boundary cell and the open cell just inside it, for position t along a side. */
function sideCells(plan: FloorPlan, side: Side, t: number): [number, number] {
  const { width: w, height: h } = plan;
  switch (side) {
    case 'north':
      return [t, t + w];
    case 'south':
      return [(h - 1) * w + t, (h - 2) * w + t];
    case 'west':
      return [t * w, t * w + 1];
    case 'east':
      return [t * w + w - 1, t * w + w - 2];
  }
}

function sideLength(plan: FloorPlan, side: Side): number {
  return side === 'north' || side === 'south' ? plan.width : plan.height;
}

/** Where along a wall, e.g. "12 m from the west corner" (measured to the opening's centre). */
function alongWall(side: Side, centre: number, cellSize: number): string {
  const corner = side === 'north' || side === 'south' ? 'west' : 'north';
  return `${Math.round(centre * cellSize)} m from the ${corner} corner`;
}

function withCells(plan: FloorPlan, cells: number[], type: CellType, name: string): FloorPlan {
  const next = plan.cells.slice();
  for (const c of cells) next[c] = type;
  return { ...plan, name, cells: next };
}

/** Chebyshev distance between two cells, in cells. */
function cellGap(w: number, a: number, b: number): number {
  return Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}

/**
 * New 2 m exits on outer walls. Each possible spot is scored by how much it would shorten everyone's route
 * out (summed over all walkable cells), with the area around the fire treated as impassable — so a spot
 * that replaces a burning exit, or serves a big crowded room, beats one that serves a small corner.
 */
function newExitCandidates(plan: FloorPlan, scenario: Scenario): Candidate[] {
  const { width: w, height: h, cells, cellSize } = plan;
  const len = Math.max(2, Math.round(EXIT_WIDTH_M / cellSize));
  const fireRadius = Math.round(4 / cellSize);
  const nearFire = (i: number) => scenario.fires.some((f) => cellGap(w, f, i) <= fireRadius);
  // A new exit must also be clear of the fire's likely spread, not just its starting point.
  const tooCloseForExit = (i: number) => scenario.fires.some((f) => cellGap(w, f, i) <= 2 * fireRadius);

  const blocked = new Uint8Array(w * h);
  const exits: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    blocked[i] = cells[i] === Cell.Wall || nearFire(i) ? 1 : 0;
    if (cells[i] === Cell.Exit) exits.push(i);
  }
  const current = computeFlowField(w, h, blocked, exits);
  // Cells that can't reach any usable exit count as far away, so serving them scores highly.
  const cap = 2 * (w + h);
  const routeLength = (d: number) => Math.min(d, cap);

  const options: { side: Side; t: number; score: number; wall: number[] }[] = [];
  const stride = Math.max(1, Math.floor(len / 2));
  for (const side of SIDES) {
    const n = sideLength(plan, side);
    for (let t = 1; t + len <= n - 1; t += stride) {
      const wall: number[] = [];
      const inner: number[] = [];
      for (let k = 0; k < len; k++) {
        const [b, i] = sideCells(plan, side, t + k);
        if (cells[b] !== Cell.Wall || cells[i] === Cell.Wall || tooCloseForExit(b)) break;
        wall.push(b);
        inner.push(i);
      }
      if (wall.length < len) continue;
      const viaNew = computeFlowField(w, h, blocked, inner);
      let score = 0;
      for (let c = 0; c < cells.length; c++) {
        if (blocked[c]) continue;
        score += Math.max(0, routeLength(current[c]) - routeLength(viaNew[c] + 1));
      }
      if (score > 0) options.push({ side, t, score, wall });
    }
  }
  options.sort((a, b) => b.score - a.score);

  // Keep suggestions meaningfully different: at least ~6 m apart, even around a corner.
  const minGap = Math.round(6 / cellSize);
  const chosen: typeof options = [];
  for (const o of options) {
    if (chosen.length >= MAX_NEW_EXITS) break;
    const mid = o.wall[Math.floor(o.wall.length / 2)];
    if (chosen.some((c) => cellGap(w, c.wall[Math.floor(c.wall.length / 2)], mid) < minGap)) continue;
    chosen.push(o);
  }
  return chosen.map((o) => {
    const where = alongWall(o.side, o.t + len / 2, cellSize);
    const width = (len * cellSize).toFixed(1).replace(/\.0$/, '');
    return {
      id: `exit-${o.side}-${o.t}`,
      kind: 'add-exit',
      title: `Add a ${width} m exit on the ${o.side} wall, ${where}`,
      detail: 'A new route out where it shortens the most escape routes, clear of the fire.',
      cells: o.wall,
      plan: withCells(plan, o.wall, Cell.Exit, `${plan.name} + ${o.side} exit`),
    };
  });
}

/** 4-connected groups of cells of one type. */
function groups(plan: FloorPlan, type: CellType): number[][] {
  const { width: w, height: h, cells } = plan;
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== type || seen[start]) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      group.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < w * h && cells[j] === type && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * Extend an opening (exit or door) along its wall by up to `perEnd` cells at each end. A cell can be opened
 * if it is wall and has walkable space on at least `needOpenSides` of its two perpendicular sides.
 */
function extendOpening(plan: FloorPlan, group: number[], perEnd: number, needOpenSides: 1 | 2): number[] {
  const { width: w, height: h, cells } = plan;
  const xs = group.map((i) => i % w);
  const ys = group.map((i) => Math.floor(i / w));
  const isWall = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === Cell.Wall;
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] !== Cell.Wall;

  let horizontal: boolean;
  if (new Set(ys).size === 1 && group.length > 1) horizontal = true;
  else if (new Set(xs).size === 1 && group.length > 1) horizontal = false;
  else horizontal = isWall(xs[0] - 1, ys[0]) || isWall(xs[0] + 1, ys[0]);

  const added: number[] = [];
  const tryCell = (x: number, y: number) => {
    if (!isWall(x, y)) return false;
    const sides = horizontal ? [isOpen(x, y - 1), isOpen(x, y + 1)] : [isOpen(x - 1, y), isOpen(x + 1, y)];
    if (sides.filter(Boolean).length < needOpenSides) return false;
    added.push(y * w + x);
    return true;
  };
  if (horizontal) {
    const y = ys[0];
    for (let k = 1; k <= perEnd && tryCell(Math.min(...xs) - k, y); k++);
    for (let k = 1; k <= perEnd && tryCell(Math.max(...xs) + k, y); k++);
  } else {
    const x = xs[0];
    for (let k = 1; k <= perEnd && tryCell(x, Math.min(...ys) - k); k++);
    for (let k = 1; k <= perEnd && tryCell(x, Math.max(...ys) + k); k++);
  }
  return added;
}

function metres(cells: number, cellSize: number): string {
  return (cells * cellSize).toFixed(1).replace(/\.0$/, '');
}

/** Widen each existing exit by up to 1 m at each end. */
function widenExitCandidates(plan: FloorPlan, exitLabels: string[]): Candidate[] {
  const perEnd = Math.max(1, Math.round(1 / plan.cellSize));
  return groups(plan, Cell.Exit).flatMap((group, i): Candidate[] => {
    const added = extendOpening(plan, group, perEnd, 1);
    if (added.length === 0) return [];
    const label = exitLabels[i] ?? `Exit ${i + 1}`;
    return [
      {
        id: `widen-exit-${i}`,
        kind: 'widen-exit',
        title: `Widen ${label} from ${metres(group.length, plan.cellSize)} m to ${metres(group.length + added.length, plan.cellSize)} m`,
        detail: 'The usual checklist fix: more door width at an existing exit.',
        cells: added,
        plan: withCells(plan, added, Cell.Exit, `${plan.name} + wider ${label.toLowerCase()}`),
      },
    ];
  });
}

/** Rough compass position of a cell within the plan, e.g. "north-west". */
function region(plan: FloorPlan, cell: number): string {
  const x = (cell % plan.width) / plan.width;
  const y = Math.floor(cell / plan.width) / plan.height;
  const ns = y < 1 / 3 ? 'north' : y > 2 / 3 ? 'south' : '';
  const ew = x < 1 / 3 ? 'west' : x > 2 / 3 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'centre';
}

/** Widen the most congested internal doors by up to 0.5 m at each end. */
function widenDoorCandidates(plan: FloorPlan, density: Float32Array): Candidate[] {
  const ranked = groups(plan, Cell.Door)
    .map((group) => ({ group, load: group.reduce((s, i) => s + density[i], 0) }))
    .filter((d) => d.load > 0)
    .sort((a, b) => b.load - a.load)
    .slice(0, MAX_DOORS);
  return ranked.flatMap(({ group }, rank): Candidate[] => {
    const added = extendOpening(plan, group, Math.max(1, Math.round(0.5 / plan.cellSize)), 2);
    if (added.length === 0) return [];
    const where = region(plan, group[Math.floor(group.length / 2)]);
    return [
      {
        id: `widen-door-${group[0]}`,
        kind: 'widen-door',
        title: `Widen the ${rank === 0 ? 'busiest' : 'second-busiest'} door (${where}) from ${metres(group.length, plan.cellSize)} m to ${metres(group.length + added.length, plan.cellSize)} m`,
        detail: 'Most queuing happened at this internal door.',
        cells: added,
        plan: withCells(plan, added, Cell.Door, `${plan.name} + wider door`),
      },
    ];
  });
}
