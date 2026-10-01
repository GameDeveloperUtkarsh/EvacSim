import type { Rng } from './rng';
import { Cell, type FloorPlan } from './types';

export interface FireConfig {
  /** Chance per second that a burning cell ignites each open orthogonal neighbour. */
  spreadRate: number;
  /** Smoke added per second to a burning cell (smoke is 0..1, where 1 is untenable). */
  smokeProduction: number;
  /** Smoke diffusion coefficient in cells²/s. Keep smokeDiffusion * dt * 4 < 1 for stability. */
  smokeDiffusion: number;
  /** Fraction of smoke per second vented out through exit cells. */
  smokeVenting: number;
}

export const DEFAULT_FIRE: FireConfig = {
  spreadRate: 0.2,
  smokeProduction: 0.6,
  smokeDiffusion: 4,
  smokeVenting: 0.5,
};

/** Cellular fire spread plus diffusing smoke on the plan grid. Walls block both. */
export class FireModel {
  readonly burning: Uint8Array;
  readonly burningCells: number[] = [];
  smoke: Float32Array;
  private scratch: Float32Array;
  private readonly open: Uint8Array;
  private readonly vent: Uint8Array;
  private readonly width: number;
  private readonly height: number;

  constructor(
    plan: FloorPlan,
    readonly cfg: FireConfig = DEFAULT_FIRE,
  ) {
    const n = plan.width * plan.height;
    this.width = plan.width;
    this.height = plan.height;
    this.burning = new Uint8Array(n);
    this.smoke = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.open = new Uint8Array(n);
    this.vent = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.open[i] = plan.cells[i] === Cell.Wall ? 0 : 1;
      this.vent[i] = plan.cells[i] === Cell.Exit ? 1 : 0;
    }
  }

  ignite(i: number): boolean {
    if (!this.open[i] || this.burning[i]) return false;
    this.burning[i] = 1;
    this.burningCells.push(i);
    return true;
  }

  step(dt: number, rng: Rng): void {
    if (this.burningCells.length === 0) return;
    const { width: w, height: h, open } = this;

    // Spread: only cells burning at the start of the step can ignite neighbours.
    const p = this.cfg.spreadRate * dt;
    const count = this.burningCells.length;
    for (let k = 0; k < count; k++) {
      const i = this.burningCells[k];
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) this.trySpread(i - 1, p, rng);
      if (x < w - 1) this.trySpread(i + 1, p, rng);
      if (y > 0) this.trySpread(i - w, p, rng);
      if (y < h - 1) this.trySpread(i + w, p, rng);
    }

    const s = this.smoke;
    const production = this.cfg.smokeProduction * dt;
    for (const i of this.burningCells) s[i] = Math.min(1, s[i] + production);

    // Explicit diffusion with no flux through walls; exits vent smoke outside.
    const k = this.cfg.smokeDiffusion * dt;
    const ventKeep = 1 - this.cfg.smokeVenting * dt;
    const next = this.scratch;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!open[i]) {
          next[i] = 0;
          continue;
        }
        const si = s[i];
        let flux = 0;
        if (x > 0 && open[i - 1]) flux += s[i - 1] - si;
        if (x < w - 1 && open[i + 1]) flux += s[i + 1] - si;
        if (y > 0 && open[i - w]) flux += s[i - w] - si;
        if (y < h - 1 && open[i + w]) flux += s[i + w] - si;
        const v = si + k * flux;
        next[i] = this.vent[i] ? v * ventKeep : v;
      }
    }
    this.scratch = s;
    this.smoke = next;
  }

  private trySpread(j: number, p: number, rng: Rng): void {
    if (this.open[j] && !this.burning[j] && rng() < p) {
      this.burning[j] = 1;
      this.burningCells.push(j);
    }
  }
}
