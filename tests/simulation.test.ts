import { describe, expect, it } from 'vitest';
import { planFromAscii } from '../src/engine/plan';
import { SAMPLE_PLANS } from '../src/engine/samples';
import { AgentState, Simulation } from '../src/engine/simulation';
import { Cell } from '../src/engine/types';

const plan = (id: string) => SAMPLE_PLANS.find((p) => p.id === id)!.build();

describe('Simulation', () => {
  it('evacuates everyone from the office when there is no hazard', () => {
    const m = new Simulation(plan('office'), { agentCount: 200, seed: 1 }).runToEnd();
    expect(m.evacuated).toBe(200);
    expect(m.dead).toBe(0);
    expect(m.time).toBeLessThan(300);
  });

  it('never leaves an agent inside a wall', () => {
    const p = plan('hall');
    const sim = new Simulation(p, { agentCount: 400, seed: 7 });
    for (let step = 0; step < 3000 && !sim.finished; step++) {
      sim.step();
      if (step % 25 !== 0) continue;
      for (let a = 0; a < sim.agentCount; a++) {
        if (sim.state[a] >= AgentState.Evacuated) continue;
        const cell = p.cells[Math.floor(sim.y[a]) * p.width + Math.floor(sim.x[a])];
        expect(cell).not.toBe(Cell.Wall);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const sim = new Simulation(plan('store'), { agentCount: 300, seed: 42 });
      sim.igniteAt(20, 20);
      return sim.runToEnd();
    };
    expect(run()).toEqual(run());
  });

  it('routes everyone away from an exit that is on fire', () => {
    const wallRow = '#'.repeat(42);
    const corridor = 'E' + '.'.repeat(40) + 'E';
    const p = planFromAscii('corridor', [wallRow, corridor, corridor, corridor, wallRow]);
    const sim = new Simulation(p, { agentCount: 30, seed: 3, reactionRange: [0, 0] });
    for (let y = 1; y <= 3; y++) sim.igniteAt(0, y);
    const m = sim.runToEnd();
    const west = sim.exits.find((e) => e.label.startsWith('West'))!;
    expect(m.exitCounts[west.id]).toBe(0);
    expect(m.evacuated + m.dead).toBe(m.total);
  });
});
