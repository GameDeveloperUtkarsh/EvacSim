import type { Recommendation, RunSummary, Scenario } from '../engine/recommend';
import type { Simulation } from '../engine/simulation';
import type { FloorPlan } from '../engine/types';
import { useRecommendations } from './useRecommendations';

const RUNS = 3;
const SHOWN = 5;

export interface FixContext {
  recommendation: Recommendation;
  baseline: RunSummary;
  plan: FloorPlan;
  scenario: Scenario;
}

interface Props {
  sim: Simulation;
  plan: FloorPlan;
  agentCount: number;
  seed: number;
  disabled: boolean;
  onCompare: (fix: FixContext) => void;
  onApply: (fix: FixContext) => void;
}

/** Sidebar panel: search for building changes, show them ranked, and hand one off to compare or apply. */
export function FixFinder({ sim, plan, agentCount, seed, disabled, onCompare, onApply }: Props) {
  const { state, start } = useRecommendations();
  const fires = sim.ignitions;

  const run = () =>
    start(plan, { agentCount, seeds: Array.from({ length: RUNS }, (_, i) => seed + i), fires: [...fires] });

  const stale = state.status === 'done' && state.scenario.fires.length !== fires.length;

  return (
    <section className="fixes">
      <h2>Fix finder</h2>
      <p className="muted small">
        {fires.length > 0
          ? `Tries changes to the building and re-runs this fire (${fires.length} start point${fires.length > 1 ? 's' : ''}) with the same people, ${RUNS} runs each.`
          : 'No fire set, so fixes are ranked by evacuation time. Click the map to add a fire first for a fire scenario.'}
      </p>
      <button className="primary" onClick={run} disabled={disabled || state.status === 'running'}>
        {state.status === 'running' ? 'Testing fixes…' : state.status === 'done' ? 'Search again' : 'Find fixes'}
      </button>

      {state.status === 'running' && (
        <div className="fix-progress">
          <div className="progress">
            <div className="progress-safe" style={{ width: `${(state.done / state.total) * 100}%` }} />
          </div>
          <p className="muted small">
            Simulated {state.done} of {state.total} runs
          </p>
        </div>
      )}

      {state.status === 'error' && <p className="error small">{state.message}</p>}

      {state.status === 'done' && (
        <>
          {stale && <p className="warnings small">The fire changed since this search. Search again to update.</p>}
          <p className="small fix-baseline">
            <strong>Now:</strong> {describe(state.result.baseline)}
          </p>
          {state.result.recommendations.length === 0 ? (
            <p className="muted small">No candidate changes found for this layout.</p>
          ) : (
            <ol className="fix-list">
              {state.result.recommendations.slice(0, SHOWN).map((rec, i) => {
                const ctx: FixContext = {
                  recommendation: rec,
                  baseline: state.result.baseline,
                  plan: state.plan,
                  scenario: state.scenario,
                };
                const impact = impactOf(rec);
                return (
                  <li key={rec.id} className="fix">
                    <div className="fix-title">
                      {i === 0 && impact.good && <span className="badge">Best</span>}
                      {rec.title}
                    </div>
                    <div className={`fix-impact ${impact.tone}`}>{impact.text}</div>
                    <div className="muted small">{describe(rec.result)}</div>
                    <div className="row">
                      <button onClick={() => onCompare(ctx)}>Compare</button>
                      <button onClick={() => onApply(ctx)}>Apply</button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function describe(s: RunSummary): string {
  const deaths = `${round(s.deaths)} of ${round(s.total)} died`;
  const time = s.t95 !== null ? `95% out in ${Math.round(s.t95)} s` : '95% never got out';
  return `${deaths}, ${time} (avg of ${RUNS} runs)`;
}

function impactOf(rec: Recommendation): { text: string; tone: 'good' | 'bad' | 'neutral'; good: boolean } {
  const lives = rec.livesSaved;
  const secs = rec.secondsSaved;
  const parts: string[] = [];
  if (lives >= 0.5) parts.push(`${round(lives)} lives saved`);
  else if (lives <= -0.5) parts.push(`${round(-lives)} more deaths`);
  if (secs !== null && Math.abs(secs) >= 1) parts.push(secs > 0 ? `${Math.round(secs)} s faster` : `${Math.round(-secs)} s slower`);
  if (parts.length === 0) return { text: 'No real improvement', tone: 'neutral', good: false };
  const good = lives >= 0.5 || (lives > -0.5 && (secs ?? 0) >= 1);
  return { text: parts.join(' · '), tone: good ? 'good' : 'bad', good };
}

function round(n: number): string {
  return Math.round(n).toString();
}
