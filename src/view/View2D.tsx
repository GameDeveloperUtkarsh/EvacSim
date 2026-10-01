import { useEffect, useRef, type MouseEvent } from 'react';
import { AgentState, type Simulation } from '../engine/simulation';
import { cellAtPoint, fitGrid, prepareCanvas, type GridLayout } from './canvas';
import { agentCss, paintCells } from './paint';

interface Props {
  sim: Simulation;
  heatmap: boolean;
  onCellClick: (gx: number, gy: number) => void;
}

/** Top-down plan view: grid painted as one pixel per cell and scaled up, agents drawn as circles. */
export function View2D({ sim, heatmap, onCellClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useRef<GridLayout>({ scale: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const grid = document.createElement('canvas');
    grid.width = sim.width;
    grid.height = sim.height;
    const gctx = grid.getContext('2d')!;
    const image = gctx.createImageData(sim.width, sim.height);
    let raf = 0;

    const draw = () => {
      const { ctx, cw, ch } = prepareCanvas(canvas);
      const { scale, ox, oy } = (layout.current = fitGrid(cw, ch, sim.width, sim.height));

      ctx.clearRect(0, 0, cw, ch);
      paintCells(sim, image.data, { heatmap, smoke: true, flipY: false });
      gctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(grid, ox, oy, sim.width * scale, sim.height * scale);

      const r = Math.max(1.5, (sim.cfg.agentRadius / sim.cellSize) * scale);
      for (let a = 0; a < sim.agentCount; a++) {
        const s = sim.state[a];
        if (s === AgentState.Evacuated) continue;
        ctx.fillStyle = agentCss(s, sim.health[a]);
        ctx.beginPath();
        ctx.arc(ox + sim.x[a] * scale, oy + sim.y[a] * scale, r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim, heatmap]);

  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const cell = cellAtPoint(e.currentTarget, layout.current, sim.width, sim.height, e.clientX, e.clientY);
    if (cell) onCellClick(cell[0], cell[1]);
  };

  return <canvas ref={canvasRef} className="view-canvas" onClick={handleClick} />;
}
