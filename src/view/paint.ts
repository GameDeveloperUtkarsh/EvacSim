import { AgentState, type Simulation } from '../engine/simulation';
import { Cell } from '../engine/types';

type Rgb = [number, number, number];

/** Base colour per cell type, indexed by Cell value. */
const BASE: Rgb[] = [
  [232, 228, 218], // floor
  [48, 52, 60], // wall
  [181, 138, 90], // door
  [52, 178, 98], // exit
];
const FIRE: Rgb = [242, 96, 32];
const SMOKE: Rgb = [78, 78, 86];
const HEAT_LOW: Rgb = [250, 214, 60];
const HEAT_HIGH: Rgb = [200, 30, 40];

export interface PaintOptions {
  heatmap: boolean;
  /** Tint cells by smoke (2D view); the 3D view draws smoke as its own layer instead. */
  smoke: boolean;
  /** Write grid row y into texture row height-1-y (WebGL textures start at the bottom). */
  flipY: boolean;
}

/** Write one RGBA pixel per grid cell into `out` (length width * height * 4). */
export function paintCells(sim: Simulation, out: Uint8Array | Uint8ClampedArray, opts: PaintOptions): void {
  const { width: w, height: h, density } = sim;
  const cells = sim.plan.cells;
  const { burning, smoke } = sim.fire;
  const heatScale = opts.heatmap && sim.densityMax > 0 ? 1 / sim.densityMax : 0;
  for (let y = 0; y < h; y++) {
    const row = opts.flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = (row * w + x) * 4;
      const type = cells[i];
      let [r, g, b] = BASE[type];
      if (type !== Cell.Wall) {
        if (heatScale > 0) {
          const t = Math.sqrt(density[i] * heatScale);
          if (t > 0.03) {
            const k = 0.3 + 0.6 * t;
            r = mix(r, mix(HEAT_LOW[0], HEAT_HIGH[0], t), k);
            g = mix(g, mix(HEAT_LOW[1], HEAT_HIGH[1], t), k);
            b = mix(b, mix(HEAT_LOW[2], HEAT_HIGH[2], t), k);
          }
        }
        if (opts.smoke) {
          const s = Math.min(1, smoke[i]) * 0.75;
          r = mix(r, SMOKE[0], s);
          g = mix(g, SMOKE[1], s);
          b = mix(b, SMOKE[2], s);
        }
        if (burning[i]) [r, g, b] = FIRE;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

/** Plan cells only (editor). Cells flagged in `unreachable` are tinted red. */
export function paintPlan(
  cells: Uint8Array,
  out: Uint8ClampedArray,
  unreachable?: Uint8Array,
): void {
  for (let i = 0; i < cells.length; i++) {
    let [r, g, b] = BASE[cells[i]];
    if (unreachable?.[i] && cells[i] !== Cell.Wall) {
      r = mix(r, 229, 0.45);
      g = mix(g, 72, 0.45);
      b = mix(b, 77, 0.45);
    }
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}

/** Smoke as a translucent RGBA layer, for drawing above the 3D floor. */
export function paintSmoke(sim: Simulation, out: Uint8Array, flipY: boolean): void {
  const { width: w, height: h } = sim;
  const { smoke } = sim.fire;
  for (let y = 0; y < h; y++) {
    const row = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4;
      out[o] = SMOKE[0];
      out[o + 1] = SMOKE[1];
      out[o + 2] = SMOKE[2];
      out[o + 3] = Math.min(1, smoke[y * w + x]) * 215;
    }
  }
}

/** Agent colour (sRGB, 0..1): blue while waiting, green→red as health drops, dark red when dead. */
export function agentRgb(state: number, health: number): Rgb {
  if (state === AgentState.Dead) return [0.42, 0.08, 0.08];
  if (state === AgentState.Waiting) return [0.31, 0.55, 1];
  return [mix(0.9, 0.18, health), mix(0.15, 0.68, health), mix(0.15, 0.3, health)];
}

export function agentCss(state: number, health: number): string {
  const [r, g, b] = agentRgb(state, health);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
