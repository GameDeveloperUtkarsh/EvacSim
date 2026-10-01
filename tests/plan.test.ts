import { describe, expect, it } from 'vitest';
import { lineCells } from '../src/editor/tools';
import { analyzePlan } from '../src/engine/analysis';
import { createBlankPlan, parsePlan, planFromAscii, serializePlan } from '../src/engine/plan';
import { SAMPLE_PLANS } from '../src/engine/samples';

describe('plan files', () => {
  it('round-trips every sample plan', () => {
    for (const sample of SAMPLE_PLANS) {
      const plan = sample.build();
      expect(parsePlan(serializePlan(plan))).toEqual(plan);
    }
  });

  it('rejects files that are not plans', () => {
    expect(() => parsePlan('{"hello": 1}')).toThrow('Not an EvacSim plan');
    expect(() => parsePlan('not json')).toThrow();
  });

  it('creates a walled blank plan of the requested size', () => {
    const plan = createBlankPlan('Blank', 10, 5);
    expect([plan.width, plan.height]).toEqual([20, 10]);
    expect(analyzePlan(plan).exitCount).toBe(0);
  });
});

describe('analyzePlan', () => {
  it('finds rooms with no route to an exit', () => {
    const plan = planFromAscii('sealed room', [
      '##########',
      'E...#....#',
      'E...#....#',
      '##########',
    ]);
    const a = analyzePlan(plan);
    expect(a.exitCount).toBe(1);
    expect(a.unreachableArea).toBeCloseTo(8 * 0.25);
    expect(a.warnings.some((w) => w.includes('no route'))).toBe(true);
  });

  it('passes a sample plan with no warnings beyond exit count', () => {
    expect(analyzePlan(SAMPLE_PLANS[0].build()).warnings).toEqual([]);
  });
});

describe('lineCells', () => {
  it('draws a gap-free line including both ends', () => {
    const cells = lineCells(0, 0, 5, 2);
    expect(cells[0]).toEqual([0, 0]);
    expect(cells[cells.length - 1]).toEqual([5, 2]);
    for (let i = 1; i < cells.length; i++) {
      expect(Math.abs(cells[i][0] - cells[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(cells[i][1] - cells[i - 1][1])).toBeLessThanOrEqual(1);
    }
  });
});
