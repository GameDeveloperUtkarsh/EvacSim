import { useEffect, useMemo, useState } from 'react';
import { Simulation, type SimMetrics } from '../engine/simulation';
import { useSimLoop } from '../useSimLoop';
import { View2D } from '../view/View2D';
import type { FixContext } from './FixFinder';

const SPEEDS = [1, 2, 5, 10, 20];
const noop = () => {};

interface Props {
  fix: FixContext;
  onApply: () => void;
  onClose: () => void;
}

/** Side-by-side replay: the current building and the fixed one, same people, same fire, in lockstep. */
export function CompareView({ fix, onApply, onClose }: Props) {
  const { recommendation: rec, baseline, plan, scenario } = fix;
  const [resetKey, setResetKey] = useState(0);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(10);

  const sims = useMemo(
    () =>
      [plan, rec.plan].map((p) => {
        const sim = new Simulation(p, { agentCount: scenario.agentCount, seed: scenario.seeds[0] });
        for (const cell of scenario.fires) sim.igniteAt(cell % p.width, Math.floor(cell / p.width));
        return sim;
      }),
    // resetKey restarts both replays together.
    [plan, rec.plan, scenario, resetKey],
  );
  useSimLoop(sims[0], running, speed);
  useSimLoop(sims[1], running, speed);

  const [metrics, setMetrics] = useState<SimMetrics[]>(() => sims.map((s) => s.metrics()));
  useEffect(() => {
    setMetrics(sims.map((s) => s.metrics()));
    const id = setInterval(() => {
      const m = sims.map((s) => s.metrics());
      setMetrics(m);
      if (m.every((x) => x.finished)) setRunning(false);
    }, 200);
    return () => clearInterval(id);
  }, [sims]);

  const restart = () => {
    setResetKey((k) => k + 1);
    setRunning(true);
  };
  const finished = metrics.every((m) => m.finished);
  const runs = scenario.seeds.length;

  return (
    <div className="compare">
      <div className="compare-head">
        <div className="compare-title">
          <span className="muted small">COMPARING FIX</span>
          <strong>{rec.title}</strong>
        </div>
        <div className="row">
          <button onClick={() => (finished ? restart() : setRunning((r) => !r))}>
            {finished ? 'Replay' : running ? 'Pause' : 'Play'}
          </button>
          <button onClick={restart}>Restart</button>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button className="primary" onClick={onApply}>
            Apply this fix
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="compare-panes">
        {sims.map((sim, i) => (
          <div className="pane" key={i}>
            <div className={`pane-label ${i === 0 ? 'before' : 'after'}`}>{i === 0 ? 'Before' : 'After the fix'}</div>
            <div className="pane-view">
              <View2D sim={sim} heatmap={false} onCellClick={noop} highlight={i === 1 ? rec.cells : undefined} />
            </div>
            <div className="pane-stats">
              <span>
                Time <strong>{formatTime(metrics[i].time)}</strong>
              </span>
              <span>
                Evacuated <strong>{metrics[i].evacuated}</strong>
              </span>
              <span className={metrics[i].dead > 0 ? 'danger' : ''}>
                Casualties <strong>{metrics[i].dead}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="compare-summary">
        Average of {runs} runs: <strong>{Math.round(baseline.deaths)}</strong> →{' '}
        <strong className={tone(baseline.deaths - rec.result.deaths)}>{Math.round(rec.result.deaths)}</strong> deaths
        {baseline.t95 !== null && rec.result.t95 !== null && (
          <>
            {' '}· 95% out in <strong>{Math.round(baseline.t95)} s</strong> →{' '}
            <strong className={tone(baseline.t95 - rec.result.t95)}>{Math.round(rec.result.t95)} s</strong>
          </>
        )}
        <span className="muted"> · This replay shows run 1.</span>
      </div>
    </div>
  );
}

/** Colour an improvement green and a regression red. */
function tone(gain: number): string {
  return gain >= 0.5 ? 'good' : gain <= -0.5 ? 'bad' : '';
}

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
}
