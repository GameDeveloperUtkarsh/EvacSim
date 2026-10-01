import { PlanBuilder } from './plan';
import type { FloorPlan } from './types';

export interface SamplePlan {
  id: string;
  name: string;
  description: string;
  build: () => FloorPlan;
}

/** 32 m × 20 m office: eight rooms off a central corridor, exits at both corridor ends. */
function office(): FloorPlan {
  const b = new PlanBuilder('Office floor', 64, 40);
  b.room(0, 0, 63, 39);
  b.wall(0, 17, 63, 17).wall(0, 22, 63, 22);
  for (const x of [16, 32, 48]) b.wall(x, 0, x, 17).wall(x, 22, x, 39);
  for (let i = 0; i < 4; i++) {
    const dx = 16 * i + 7;
    b.door(dx, 17, dx + 1, 17).door(dx, 22, dx + 1, 22);
  }
  b.exit(0, 18, 0, 21).exit(63, 18, 63, 21);
  return b.build();
}

/** 28 m × 20 m event hall with back rooms and a single 1.5 m exit — a deliberately poor design. */
function hall(): FloorPlan {
  const b = new PlanBuilder('Event hall', 56, 40);
  b.room(0, 0, 55, 39);
  b.wall(40, 0, 40, 39).wall(40, 13, 55, 13).wall(40, 26, 55, 26);
  b.door(40, 6, 40, 7).door(40, 19, 40, 20).door(40, 32, 40, 33);
  for (const [x, y] of [[12, 12], [26, 12], [12, 26], [26, 26]]) b.wall(x, y, x + 1, y + 1);
  b.exit(6, 39, 8, 39);
  return b.build();
}

/** 28 m × 22 m supermarket: shelving aisles, a stockroom, three exits of different widths. */
function store(): FloorPlan {
  const b = new PlanBuilder('Supermarket', 56, 44);
  b.room(0, 0, 55, 43);
  for (let y = 8; y <= 32; y += 6) b.wall(6, y, 38, y);
  b.wall(44, 0, 44, 22).wall(44, 22, 55, 22).door(44, 16, 44, 17);
  b.exit(24, 43, 27, 43).exit(55, 30, 55, 31).exit(50, 0, 51, 0);
  return b.build();
}

export const SAMPLE_PLANS: SamplePlan[] = [
  { id: 'office', name: 'Office floor', description: '8 rooms, central corridor, 2 exits', build: office },
  { id: 'hall', name: 'Event hall', description: 'Open hall, back rooms, 1 narrow exit', build: hall },
  { id: 'store', name: 'Supermarket', description: 'Aisles, stockroom, 3 exits', build: store },
];
