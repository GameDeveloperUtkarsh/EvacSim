import { useRef, useState, type ChangeEvent } from 'react';
import type { PlanAnalysis } from '../engine/analysis';
import { createBlankPlan, parsePlan, serializePlan } from '../engine/plan';
import { SAMPLE_PLANS } from '../engine/samples';
import type { FloorPlan } from '../engine/types';
import { TOOLS, type Tool } from './tools';

interface Props {
  plan: FloorPlan;
  analysis: PlanAnalysis;
  tool: Tool;
  brush: number;
  canUndo: boolean;
  onTool: (tool: Tool) => void;
  onBrush: (size: number) => void;
  onUndo: () => void;
  /** Replace the whole plan (new, template, import); undoable. */
  onReplace: (plan: FloorPlan) => void;
  onRename: (name: string) => void;
  onDone: () => void;
}

export function EditorPanel(props: Props) {
  const { plan, analysis, tool, brush, canUndo, onTool, onBrush, onUndo, onReplace, onRename, onDone } = props;
  const [newW, setNewW] = useState(30);
  const [newH, setNewH] = useState(20);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startFrom = (value: string) => {
    if (!value) return;
    if (!confirm('Replace the current plan? You can undo this.')) return;
    if (value === 'blank') onReplace(createBlankPlan('My building', newW, newH));
    else {
      const sample = SAMPLE_PLANS.find((p) => p.id === value)!.build();
      onReplace({ ...sample, name: `My ${sample.name.toLowerCase()}` });
    }
  };

  const exportPlan = () => {
    const blob = new Blob([serializePlan(plan)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name.replace(/[^\w-]+/g, '_') || 'plan'}.evacsim.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPlan = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      onReplace(parsePlan(await file.text()));
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const active = TOOLS.find((t) => t.id === tool)!;
  const widthM = plan.width * plan.cellSize;
  const heightM = plan.height * plan.cellSize;

  return (
    <>
      <section>
        <label className="field">
          <span>Plan name</span>
          <input type="text" value={plan.name} onChange={(e) => onRename(e.target.value)} />
        </label>
        <p className="muted small">
          {widthM} × {heightM} m · {Math.round(analysis.floorArea)} m² walkable · 1 cell = {plan.cellSize} m
        </p>
      </section>

      <section>
        <h2>Tools</h2>
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool tool-${t.id} ${tool === t.id ? 'active' : ''}`}
              onClick={() => onTool(t.id)}
              title={`${t.hint} (${t.key})`}
            >
              <i />
              {t.label}
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <p className="muted small">{active.hint}</p>
        <div className="row">
          <span className="small">Brush</span>
          <div className="segmented">
            {[1, 2, 3].map((s) => (
              <button key={s} className={brush === s ? 'active' : ''} onClick={() => onBrush(s)}>
                {(s * plan.cellSize).toFixed(1)} m
              </button>
            ))}
          </div>
          <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
        </div>
      </section>

      <section>
        <h2>Checks</h2>
        {analysis.warnings.length === 0 ? (
          <p className="ok small">
            {analysis.exitCount} exits, every area can reach one. Ready to simulate.
          </p>
        ) : (
          <ul className="warnings">
            {analysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Start over</h2>
        <div className="row">
          <label className="field grow">
            <span>Width (m)</span>
            <input type="number" min={3} max={120} value={newW} onChange={(e) => setNewW(Number(e.target.value))} />
          </label>
          <label className="field grow">
            <span>Depth (m)</span>
            <input type="number" min={3} max={120} value={newH} onChange={(e) => setNewH(Number(e.target.value))} />
          </label>
        </div>
        <select value="" onChange={(e) => startFrom(e.target.value)} aria-label="Start from template">
          <option value="">Start from…</option>
          <option value="blank">Blank floor ({newW} × {newH} m)</option>
          {SAMPLE_PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              Copy of {p.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>File</h2>
        <div className="row">
          <button onClick={exportPlan}>Export</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importPlan} />
        </div>
        {importError && <p className="error small">{importError}</p>}
      </section>

      <button className="primary" onClick={onDone} disabled={analysis.exitCount === 0}>
        Simulate this plan
      </button>
    </>
  );
}
