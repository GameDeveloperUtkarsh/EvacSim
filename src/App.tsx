import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorCanvas } from './editor/EditorCanvas';
import { EditorPanel } from './editor/EditorPanel';
import { TOOLS, type Tool } from './editor/tools';
import { analyzePlan } from './engine/analysis';
import { parsePlan, serializePlan } from './engine/plan';
import { SAMPLE_PLANS } from './engine/samples';
import { CompareView } from './recommend/CompareView';
import { FixFinder, type FixContext } from './recommend/FixFinder';
import { gradeRun } from './engine/score';
import { Simulation, type SimMetrics } from './engine/simulation';
import { Cell, type FloorPlan } from './engine/types';
import { useSimLoop } from './useSimLoop';
import { View2D } from './view/View2D';
import { View3D } from './view/View3D';

const SPEEDS = [1, 2, 5, 10, 20];
const CUSTOM_ID = 'custom';
const STORAGE_KEY = 'evacsim.customPlan';
const MAX_UNDO = 50;

/**
 * Scenario link: preloads a demo setup from the URL, e.g.
 * `?plan=hall&n=300&seed=1&fire=8,34&view=2d&heatmap=1&speed=10&run=1&stopAt=40` (`;` separates fires).
 * Handy for live demos and for capturing screenshots automatically.
 */
interface Scenario {
  active: boolean;
  plan?: string;
  agents?: number;
  seed?: number;
  fires: [number, number][];
  view?: '2d' | '3d';
  heatmap: boolean;
  speed?: number;
  run: boolean;
  stopAt?: number;
  edit: boolean;
}

function readScenario(): Scenario {
  const q = new URLSearchParams(window.location.search);
  const num = (key: string) => {
    const v = Number(q.get(key));
    return q.has(key) && Number.isFinite(v) ? v : undefined;
  };
  const fires = (q.get('fire') ?? '')
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter((p): p is [number, number] => p.length === 2 && p.every(Number.isInteger));
  const view = q.get('view');
  return {
    active: q.size > 0,
    plan: q.get('plan') ?? undefined,
    agents: num('n'),
    seed: num('seed'),
    fires,
    view: view === '2d' || view === '3d' ? view : undefined,
    heatmap: q.get('heatmap') === '1',
    speed: num('speed'),
    run: q.get('run') === '1',
    stopAt: num('stopAt'),
    edit: q.get('mode') === 'edit',
  };
}

const SCENARIO = readScenario();

/** The user's own plan is kept in this browser so a refresh doesn't lose it. */
function loadCustomPlan(): FloorPlan | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parsePlan(text) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [customPlan, setCustomPlan] = useState<FloorPlan | null>(loadCustomPlan);
  const [mode, setMode] = useState<'simulate' | 'edit'>(SCENARIO.edit && customPlan ? 'edit' : 'simulate');
  const [planId, setPlanId] = useState(SCENARIO.edit ? CUSTOM_ID : (SCENARIO.plan ?? SAMPLE_PLANS[0].id));
  const [history, setHistory] = useState<FloorPlan[]>([]);
  const [tool, setTool] = useState<Tool>('wall');
  const [brush, setBrush] = useState(1);
  const [agentCount, setAgentCount] = useState(SCENARIO.agents ?? 250);
  const [seed, setSeed] = useState(SCENARIO.seed ?? 1);
  const [resetKey, setResetKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(SCENARIO.speed ?? 5);
  const [view, setView] = useState<'2d' | '3d'>(SCENARIO.view ?? '3d');
  const [heatmap, setHeatmap] = useState(SCENARIO.heatmap);
  const scenarioSim = useRef<Simulation | null>(null);
  const [compare, setCompare] = useState<FixContext | null>(null);
  // Fire starts to re-apply once the next simulation exists (after applying a fix).
  const pendingFires = useRef<number[] | null>(null);

  const sample = SAMPLE_PLANS.find((p) => p.id === planId) ?? SAMPLE_PLANS[0];
  const samplePlan = useMemo(() => sample.build(), [sample]);
  const isCustom = planId === CUSTOM_ID && customPlan !== null;
  const plan = isCustom ? customPlan : samplePlan;
  const analysis = useMemo(() => analyzePlan(plan), [plan]);
  // resetKey is a dependency so "Reset" builds a fresh run of the same scenario.
  const sim = useMemo(() => new Simulation(plan, { agentCount, seed }), [plan, agentCount, seed, resetKey]);
  const [metrics, setMetrics] = useState<SimMetrics>(() => sim.metrics());

  // A scenario link's stop time pauses its run once; pressing Run afterwards carries on normally.
  const [stopAt, setStopAt] = useState(SCENARIO.stopAt);
  useSimLoop(sim, running && mode === 'simulate', speed, stopAt, () => {
    setStopAt(undefined);
    setRunning(false);
  });

  useEffect(() => {
    setRunning(false);
    setMetrics(sim.metrics());
    const id = setInterval(() => {
      const m = sim.metrics();
      setMetrics(m);
      if (m.finished) setRunning(false);
      if (SCENARIO.active) {
        // Lets automation (screenshot capture) see how far the run has got.
        document.documentElement.dataset.simTime = m.time.toFixed(1);
        document.documentElement.dataset.simFinished = String(m.finished);
      }
    }, 200);
    return () => clearInterval(id);
  }, [sim]);

  // Apply the scenario link to the first simulation only; later resets start clean.
  useEffect(() => {
    if (scenarioSim.current === null) {
      scenarioSim.current = sim;
      for (const [x, y] of SCENARIO.fires) sim.igniteAt(x, y);
    }
    if (scenarioSim.current === sim) {
      if (SCENARIO.run) setRunning(true);
    } else {
      setStopAt(undefined);
    }
  }, [sim]);

  useEffect(() => {
    const fires = pendingFires.current;
    if (!fires) return;
    pendingFires.current = null;
    for (const cell of fires) sim.igniteAt(cell % sim.width, Math.floor(cell / sim.width));
  }, [sim]);

  useEffect(() => {
    if (!customPlan) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializePlan(customPlan));
    } catch {
      // Storage unavailable (private mode, quota): the plan still lives in memory and can be exported.
    }
  }, [customPlan]);

  const commitPlan = (next: FloorPlan) => {
    if (customPlan) setHistory((h) => [...h.slice(-(MAX_UNDO - 1)), customPlan]);
    setCustomPlan(next);
  };

  const undo = () => {
    if (history.length === 0) return;
    setCustomPlan(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };

  const openEditor = () => {
    if (!customPlan) {
      setCustomPlan({ ...plan, cells: plan.cells.slice(), name: `My ${plan.name.toLowerCase()}` });
    }
    setPlanId(CUSTOM_ID);
    setRunning(false);
    setMode('edit');
  };

  // Editor shortcuts: 1–5 pick a tool, Ctrl/Cmd+Z undoes.
  useEffect(() => {
    if (mode !== 'edit') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      const t = TOOLS.find((t) => t.key === e.key);
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const floorArea = analysis.floorArea;

  const openCompare = (fix: FixContext) => {
    setRunning(false);
    setCompare(fix);
  };

  /** Save the fixed layout as the user's plan (undoable in the editor) and keep the same fire. */
  const applyFix = (fix: FixContext) => {
    commitPlan(fix.recommendation.plan);
    setPlanId(CUSTOM_ID);
    pendingFires.current = fix.scenario.fires;
    setCompare(null);
  };

  const igniteAt = (gx: number, gy: number) => {
    sim.igniteAt(gx, gy);
  };

  const randomFire = () => {
    for (let tries = 0; tries < 1000; tries++) {
      const i = Math.floor(Math.random() * plan.cells.length);
      if (plan.cells[i] === Cell.Floor) {
        igniteAt(i % plan.width, Math.floor(i / plan.width));
        return;
      }
    }
  };

  const grade = metrics.finished ? gradeRun(metrics, sim.exits) : null;
  const ViewComponent = view === '3d' ? View3D : View2D;

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>EvacSim</h1>
          <p className="muted">Building evacuation simulator</p>
        </header>

        <div className="segmented tabs">
          <button className={mode === 'simulate' ? 'active' : ''} onClick={() => setMode('simulate')}>
            Simulate
          </button>
          <button className={mode === 'edit' ? 'active' : ''} onClick={openEditor}>
            Plan editor
          </button>
        </div>

        {mode === 'edit' && customPlan ? (
          <EditorPanel
            plan={customPlan}
            analysis={analysis}
            tool={tool}
            brush={brush}
            canUndo={history.length > 0}
            onTool={setTool}
            onBrush={setBrush}
            onUndo={undo}
            onReplace={commitPlan}
            onRename={(name) => setCustomPlan({ ...customPlan, name })}
            onDone={() => setMode('simulate')}
          />
        ) : (
          <>
            <section>
              <label className="field">
                <span>Building</span>
                <select value={isCustom ? CUSTOM_ID : sample.id} onChange={(e) => setPlanId(e.target.value)}>
                  {customPlan && <option value={CUSTOM_ID}>My plan: {customPlan.name}</option>}
                  {SAMPLE_PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                {isCustom ? `${analysis.exitCount} exits` : sample.description} · {Math.round(floorArea)} m²
              </p>
              {isCustom && analysis.warnings.length > 0 && (
                <ul className="warnings">
                  {analysis.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <label className="field">
                <span>
                  Occupants <strong>{sim.agentCount}</strong>
                </span>
                <input
                  type="range"
                  min={10}
                  max={1000}
                  step={10}
                  value={agentCount}
                  onChange={(e) => setAgentCount(Number(e.target.value))}
                />
              </label>
              <p className="muted small">{(sim.agentCount / floorArea).toFixed(2)} people/m²</p>
              <div className="row">
                <label className="field grow">
                  <span>Seed</span>
                  <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
                </label>
                <button onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>Shuffle</button>
              </div>
            </section>

            <section>
              <h2>Hazard: fire</h2>
              <p className="muted small">Click anywhere on the map to start a fire.</p>
              <button onClick={randomFire}>Random fire</button>
            </section>

            <FixFinder
              key={sim.id}
              sim={sim}
              plan={plan}
              agentCount={agentCount}
              seed={seed}
              disabled={analysis.exitCount === 0}
              onCompare={openCompare}
              onApply={applyFix}
            />

            <section className="row">
              <button className="primary grow" onClick={() => setRunning((r) => !r)} disabled={metrics.finished}>
                {metrics.finished ? 'Finished' : running ? 'Pause' : 'Run'}
              </button>
              <button onClick={() => setResetKey((k) => k + 1)}>Reset</button>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </section>

            <section className="row">
              <div className="segmented">
                <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
                  2D
                </button>
                <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
                  3D
                </button>
              </div>
              <label className="check">
                <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} />
                Congestion heatmap
              </label>
            </section>

            <Stats metrics={metrics} exitLabels={sim.exits.map((e) => e.label)} />

            {grade && (
              <section className={`grade grade-${grade.letter}`}>
                <div className="grade-letter">{grade.letter}</div>
                <div>
                  <strong>{Math.round(grade.survival * 100)}% survived</strong>
                  <ul>
                    {grade.findings.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="muted small">Preliminary grade, not a safety certification.</p>
                </div>
              </section>
            )}

            <Legend />
          </>
        )}
      </aside>

      <main className="stage">
        {mode === 'edit' && customPlan ? (
          <EditorCanvas
            plan={customPlan}
            tool={tool}
            brush={brush}
            unreachable={analysis.unreachable}
            onCommit={(cells) => commitPlan({ ...customPlan, cells })}
          />
        ) : compare ? (
          <CompareView fix={compare} onApply={() => applyFix(compare)} onClose={() => setCompare(null)} />
        ) : (
          <ViewComponent sim={sim} heatmap={heatmap} onCellClick={igniteAt} />
        )}
      </main>
    </div>
  );
}

function Stats({ metrics: m, exitLabels }: { metrics: SimMetrics; exitLabels: string[] }) {
  const pct = (n: number) => (m.total ? (n / m.total) * 100 : 0);
  const usedTotal = m.exitCounts.reduce((s, n) => s + n, 0);
  return (
    <section>
      <h2>Live stats</h2>
      <div className="stat-grid">
        <Stat label="Time" value={formatTime(m.time)} />
        <Stat label="Evacuated" value={`${m.evacuated}`} />
        <Stat label="Casualties" value={`${m.dead}`} danger={m.dead > 0} />
        <Stat label="Inside" value={`${m.remaining}`} />
      </div>
      <div className="progress" aria-label="Evacuation progress">
        <div className="progress-safe" style={{ width: `${pct(m.evacuated)}%` }} />
        <div className="progress-dead" style={{ width: `${pct(m.dead)}%` }} />
      </div>
      <h3>Exit usage</h3>
      {exitLabels.map((label, i) => {
        const n = m.exitCounts[i] ?? 0;
        return (
          <div className="exit-row" key={label}>
            <span>{label}</span>
            <div className="bar">
              <div style={{ width: `${usedTotal ? (n / usedTotal) * 100 : 0}%` }} />
            </div>
            <span className="num">{n}</span>
          </div>
        );
      })}
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`stat ${danger ? 'danger' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    ['#4f8cff', 'Not yet reacting'],
    ['#2eae4d', 'Evacuating'],
    ['#e62626', 'Injured'],
    ['#6b1414', 'Casualty'],
    ['#34b262', 'Exit'],
    ['#f26020', 'Fire'],
    ['#4e4e56', 'Smoke'],
  ];
  return (
    <section className="legend">
      {items.map(([color, label]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </section>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
}
