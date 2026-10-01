import { useEffect, useRef } from 'react';
import type { Simulation } from './engine/simulation';

/**
 * Advance the simulation in fixed steps, `speed` simulated seconds per real second, while running.
 * With `stopAt`, stepping halts once that many simulated seconds have passed and `onStop` is called.
 */
export function useSimLoop(
  sim: Simulation,
  running: boolean,
  speed: number,
  stopAt?: number,
  onStop?: () => void,
): void {
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const dt = sim.cfg.dt;
    const limit = stopAt ?? Infinity;
    const tick = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000) * speed;
      last = now;
      let steps = 0;
      while (acc >= dt && steps < 500 && !sim.finished && sim.time < limit) {
        sim.step();
        acc -= dt;
        steps++;
      }
      acc = Math.min(acc, dt);
      if (sim.time >= limit) onStopRef.current?.();
      else if (!sim.finished) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, running, speed, stopAt]);
}
