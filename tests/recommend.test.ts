import { describe, expect, it } from 'vitest';
import { recommend } from '../src/engine/recommend';
import { SAMPLE_PLANS } from '../src/engine/samples';
import { Cell } from '../src/engine/types';

const plan = (id: string) => SAMPLE_PLANS.find((p) => p.id === id)!.build();

describe('recommend', () => {
  const hall = plan('hall');
  const fireAtExit = 34 * hall.width + 8;
  const result = recommend(hall, { agentCount: 200, seeds: [1, 2], fires: [fireAtExit] });

  it('ranks a new exit first when the only exit is on fire', () => {
    const best = result.recommendations[0];
    expect(best.kind).toBe('add-exit');
    expect(best.livesSaved).toBeGreaterThan(result.baseline.deaths * 0.25);
  });

  it('shows that widening the burning exit barely helps', () => {
    const widen = result.recommendations.find((r) => r.kind === 'widen-exit')!;
    expect(widen).toBeDefined();
    expect(widen.livesSaved).toBeLessThan(result.recommendations[0].livesSaved / 4);
  });

  it('only changes wall cells, and never next to the fire', () => {
    for (const rec of result.recommendations) {
      for (const cell of rec.cells) expect(hall.cells[cell]).toBe(Cell.Wall);
      if (rec.kind !== 'add-exit') continue;
      for (const cell of rec.cells) {
        const dx = Math.abs((cell % hall.width) - (fireAtExit % hall.width));
        const dy = Math.abs(Math.floor(cell / hall.width) - Math.floor(fireAtExit / hall.width));
        expect(Math.max(dx, dy)).toBeGreaterThan(8);
      }
    }
  });

  it('ranks by evacuation time when there is no fire', () => {
    const r = recommend(plan('office'), { agentCount: 150, seeds: [1], fires: [] });
    expect(r.baseline.deaths).toBe(0);
    const best = r.recommendations[0];
    expect(best.secondsSaved).not.toBeNull();
    expect(best.secondsSaved!).toBeGreaterThan(0);
  });
});
