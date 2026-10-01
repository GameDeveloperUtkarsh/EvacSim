# EvacSim

Upload a building plan, fill it with people, start a disaster, and see how well the building evacuates.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests (headless)
npm run build    # type-check + production build
```

## How it works

The floor plan is a grid of 0.5 m cells (floor, wall, door, exit). Every hazard and every agent lives on that grid.

- **Routing**: Dijkstra flow field from all exits (`src/engine/flowfield.ts`). Burning cells are impassable, smoke adds cost. Re-planned every second.
- **Crowd**: agents step downhill on the flow field, slowed by local density (Weidmann fundamental diagram) and smoke, pushed apart from each other and slide along walls (`src/engine/simulation.ts`).
- **Behaviour**: per-agent walking speed (0.9 to 1.5 m/s) and pre-movement time (0 to 15 s), cut short when smoke reaches them.
- **Fire**: cellular spread + diffusing smoke vented at exits; smoke and flames cost health (`src/engine/fire.ts`).
- **Score**: preliminary A to F grade from survival and 95% evacuation time (`src/engine/score.ts`).

The engine has no DOM dependencies and is deterministic per seed, so the same scenario can be re-run headless to compare designs.

## Layout

```
src/engine/   simulation core (pure TS): plan, flow field, fire, agents, scoring, plan checks, sample buildings
src/editor/   plan editor (tools, canvas, panel)
src/view/     2D canvas and 3D (react-three-fiber) renderers
src/App.tsx   controls, live stats, grade card
tests/        vitest engine tests
```

## Roadmap

- [x] Grid engine, flow-field agents, crowd density, fire and smoke, 2D/3D views, heatmap, grade
- [x] Plan editor: wall/room/door/exit/erase tools, undo, reachability checks, JSON import/export, autosave
- [ ] Flood and earthquake scenarios
- [ ] Bottleneck detection
- [ ] Suggestion engine: try fixes in headless runs (Web Worker), show before/after
- [ ] Image upload and wall detection (OpenCV.js)
- [ ] Report screen, real-incident demo layout
