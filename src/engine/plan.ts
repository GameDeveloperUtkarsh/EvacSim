import { Cell, type CellType, type FloorPlan } from './types';

/** Helper for authoring floor plans in code (sample buildings, tests). All coordinates are inclusive. */
export class PlanBuilder {
  readonly cells: Uint8Array;

  constructor(
    readonly name: string,
    readonly width: number,
    readonly height: number,
    readonly cellSize = 0.5,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  fill(x0: number, y0: number, x1: number, y1: number, type: CellType): this {
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    for (let y = Math.max(0, ay); y <= Math.min(this.height - 1, by); y++) {
      for (let x = Math.max(0, ax); x <= Math.min(this.width - 1, bx); x++) {
        this.cells[y * this.width + x] = type;
      }
    }
    return this;
  }

  wall(x0: number, y0: number, x1: number, y1: number): this {
    return this.fill(x0, y0, x1, y1, Cell.Wall);
  }

  door(x0: number, y0: number, x1: number, y1: number): this {
    return this.fill(x0, y0, x1, y1, Cell.Door);
  }

  exit(x0: number, y0: number, x1: number, y1: number): this {
    return this.fill(x0, y0, x1, y1, Cell.Exit);
  }

  /** Outline a rectangle with walls. */
  room(x0: number, y0: number, x1: number, y1: number): this {
    return this.wall(x0, y0, x1, y0).wall(x0, y1, x1, y1).wall(x0, y0, x0, y1).wall(x1, y0, x1, y1);
  }

  build(): FloorPlan {
    const { name, width, height, cellSize } = this;
    return { name, width, height, cellSize, cells: this.cells.slice() };
  }
}

/** Largest plan side, in cells, the editor and importer accept. */
export const MAX_PLAN_CELLS = 240;

/** An empty floor of the given size in metres, enclosed by walls. */
export function createBlankPlan(name: string, widthM: number, heightM: number, cellSize = 0.5): FloorPlan {
  const clamp = (m: number) => Math.min(MAX_PLAN_CELLS, Math.max(6, Math.round(m / cellSize)));
  const b = new PlanBuilder(name, clamp(widthM), clamp(heightM), cellSize);
  return b.room(0, 0, b.width - 1, b.height - 1).build();
}

const ASCII: Record<string, CellType> = { '#': Cell.Wall, D: Cell.Door, E: Cell.Exit };
const TO_ASCII = ['.', '#', 'D', 'E'];

export function planToAscii(plan: FloorPlan): string[] {
  const rows: string[] = [];
  for (let y = 0; y < plan.height; y++) {
    let row = '';
    for (let x = 0; x < plan.width; x++) row += TO_ASCII[plan.cells[y * plan.width + x]];
    rows.push(row);
  }
  return rows;
}

/** Plan file format: human-readable JSON with one text row per grid row. */
export function serializePlan(plan: FloorPlan): string {
  const { name, cellSize } = plan;
  return JSON.stringify({ format: 'evacsim-plan', version: 1, name, cellSize, rows: planToAscii(plan) }, null, 1);
}

/** Parse a plan file; throws an Error with a readable message if it is not a valid plan. */
export function parsePlan(text: string): FloorPlan {
  const data = JSON.parse(text) as { format?: string; name?: unknown; cellSize?: unknown; rows?: unknown };
  if (data.format !== 'evacsim-plan' || !Array.isArray(data.rows) || data.rows.length === 0) {
    throw new Error('Not an EvacSim plan file.');
  }
  const rows = data.rows.map(String);
  const width = Math.max(...rows.map((r) => r.length));
  if (width > MAX_PLAN_CELLS || rows.length > MAX_PLAN_CELLS) {
    throw new Error(`Plan is too large (max ${MAX_PLAN_CELLS}×${MAX_PLAN_CELLS} cells).`);
  }
  const cellSize = typeof data.cellSize === 'number' && data.cellSize > 0 ? data.cellSize : 0.5;
  const name = typeof data.name === 'string' && data.name ? data.name : 'Imported plan';
  return planFromAscii(name, rows, cellSize);
}

/** Parse a plan from rows of text: `#` wall, `D` door, `E` exit, anything else floor. */
export function planFromAscii(name: string, rows: string[], cellSize = 0.5): FloorPlan {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) cells[y * width + x] = ASCII[row[x]] ?? Cell.Floor;
  });
  return { name, width, height, cellSize, cells };
}
