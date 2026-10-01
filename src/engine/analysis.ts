import { computeFlowField } from './flowfield';
import { Cell, type FloorPlan } from './types';

export interface PlanAnalysis {
  /** Walkable area in m² (floor, doors, exits). */
  floorArea: number;
  exitCount: number;
  /** 1 for walkable cells with no route to any exit. */
  unreachable: Uint8Array;
  unreachableArea: number;
  warnings: string[];
}

/** Static checks run while editing, before any simulation. */
export function analyzePlan(plan: FloorPlan): PlanAnalysis {
  const { width, height, cells, cellSize } = plan;
  const n = width * height;
  const blocked = new Uint8Array(n);
  const targets: number[] = [];
  let open = 0;
  for (let i = 0; i < n; i++) {
    blocked[i] = cells[i] === Cell.Wall ? 1 : 0;
    if (!blocked[i]) open++;
    if (cells[i] === Cell.Exit) targets.push(i);
  }
  const dist = computeFlowField(width, height, blocked, targets);

  const unreachable = new Uint8Array(n);
  let lost = 0;
  for (let i = 0; i < n; i++) {
    if (!blocked[i] && !Number.isFinite(dist[i])) {
      unreachable[i] = 1;
      lost++;
    }
  }

  const cellArea = cellSize * cellSize;
  const exitCount = countGroups(plan, Cell.Exit);
  const warnings: string[] = [];
  if (exitCount === 0) warnings.push('No exits yet: paint at least one exit (green) on an outer wall.');
  else if (exitCount === 1) warnings.push('Only one exit. Most codes require two for anything but small rooms.');
  if (exitCount > 0 && lost > 0) {
    warnings.push(`${Math.round(lost * cellArea)} m² of floor has no route to an exit (shaded red on the plan).`);
  }
  return { floorArea: open * cellArea, exitCount, unreachable, unreachableArea: lost * cellArea, warnings };
}

/** Number of 4-connected groups of cells of the given type. */
function countGroups(plan: FloorPlan, type: number): number {
  const { width: w, height: h, cells } = plan;
  const seen = new Uint8Array(w * h);
  let groups = 0;
  for (let start = 0; start < w * h; start++) {
    if (cells[start] !== type || seen[start]) continue;
    groups++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < w * h && cells[j] === type && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return groups;
}
