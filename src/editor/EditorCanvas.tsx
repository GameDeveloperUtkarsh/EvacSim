import { useEffect, useRef, type PointerEvent } from 'react';
import { Cell } from '../engine/types';
import type { FloorPlan } from '../engine/types';
import { cellAtPoint, fitGrid, prepareCanvas, type GridLayout } from '../view/canvas';
import { paintPlan } from '../view/paint';
import { lineCells, TOOL_CELL, type Tool } from './tools';

interface Props {
  plan: FloorPlan;
  tool: Tool;
  brush: number;
  unreachable: Uint8Array;
  /** Called once per finished stroke with the edited cells. */
  onCommit: (cells: Uint8Array) => void;
}

interface Drag {
  tool: Tool;
  start: [number, number];
  last: [number, number];
  changed: boolean;
}

const PREVIEW: Record<Tool, string> = {
  wall: 'rgba(48,52,60,0.6)',
  room: 'rgba(79,140,255,0.9)',
  door: 'rgba(181,138,90,0.8)',
  exit: 'rgba(52,178,98,0.8)',
  erase: 'rgba(229,72,77,0.8)',
};

/** Paintable plan canvas. Edits go into a working copy and are committed when the stroke ends. */
export function EditorCanvas({ plan, tool, brush, unreachable, onCommit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useRef<GridLayout>({ scale: 1, ox: 0, oy: 0 });
  const working = useRef(plan.cells.slice());
  const drag = useRef<Drag | null>(null);
  const hover = useRef<[number, number] | null>(null);
  const live = useRef({ tool, brush });
  live.current = { tool, brush };

  useEffect(() => {
    working.current = plan.cells.slice();
  }, [plan]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { width: w, height: h } = plan;
    const grid = document.createElement('canvas');
    grid.width = w;
    grid.height = h;
    const gctx = grid.getContext('2d')!;
    const image = gctx.createImageData(w, h);
    let raf = 0;

    const draw = () => {
      const { ctx, cw, ch } = prepareCanvas(canvas);
      const { scale, ox, oy } = (layout.current = fitGrid(cw, ch, w, h, 28));
      ctx.clearRect(0, 0, cw, ch);

      paintPlan(working.current, image.data, drag.current ? undefined : unreachable);
      gctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(grid, ox, oy, w * scale, h * scale);

      // Grid: faint every cell when zoomed in enough, stronger every 5 m.
      const major = Math.max(1, Math.round(5 / plan.cellSize));
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x++) {
        if (x % major !== 0 && scale < 7) continue;
        ctx.strokeStyle = x % major === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)';
        ctx.beginPath();
        ctx.moveTo(Math.round(ox + x * scale) + 0.5, oy);
        ctx.lineTo(Math.round(ox + x * scale) + 0.5, oy + h * scale);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y++) {
        if (y % major !== 0 && scale < 7) continue;
        ctx.strokeStyle = y % major === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)';
        ctx.beginPath();
        ctx.moveTo(ox, Math.round(oy + y * scale) + 0.5);
        ctx.lineTo(ox + w * scale, Math.round(oy + y * scale) + 0.5);
        ctx.stroke();
      }

      // Scale bar.
      ctx.fillStyle = '#8a94a6';
      ctx.fillRect(ox, oy + h * scale + 10, major * scale, 3);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('5 m', ox + major * scale + 6, oy + h * scale + 15);

      // Tool preview: room rectangle while dragging, brush footprint while hovering.
      const d = drag.current;
      if (d && d.tool === 'room') {
        const [x0, x1] = [Math.min(d.start[0], d.last[0]), Math.max(d.start[0], d.last[0])];
        const [y0, y1] = [Math.min(d.start[1], d.last[1]), Math.max(d.start[1], d.last[1])];
        ctx.strokeStyle = PREVIEW.room;
        ctx.lineWidth = Math.max(2, scale);
        ctx.strokeRect(ox + (x0 + 0.5) * scale, oy + (y0 + 0.5) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
        ctx.fillStyle = '#e6e9ef';
        ctx.fillText(
          `${((x1 - x0 + 1) * plan.cellSize).toFixed(1)} × ${((y1 - y0 + 1) * plan.cellSize).toFixed(1)} m`,
          ox + (x1 + 1) * scale + 6,
          oy + (y1 + 1) * scale + 4,
        );
      } else if (hover.current) {
        const t = d?.tool ?? live.current.tool;
        const size = t === 'room' ? 1 : live.current.brush;
        const [hx, hy] = brushOrigin(hover.current, size);
        ctx.strokeStyle = PREVIEW[t];
        ctx.lineWidth = 2;
        ctx.strokeRect(ox + hx * scale, oy + hy * scale, size * scale, size * scale);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [plan, unreachable]);

  const paint = (cx: number, cy: number, t: Tool, size: number): boolean => {
    const cells = working.current;
    const value = TOOL_CELL[t];
    const [x0, y0] = brushOrigin([cx, cy], size);
    let changed = false;
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        if (x < 0 || y < 0 || x >= plan.width || y >= plan.height) continue;
        const i = y * plan.width + x;
        // Doors are cut into walls: skip open floor so a loose stroke doesn't scatter door cells in rooms.
        if (t === 'door' && cells[i] === Cell.Floor) continue;
        if (cells[i] !== value) {
          cells[i] = value;
          changed = true;
        }
      }
    }
    return changed;
  };

  const cellOf = (e: PointerEvent<HTMLCanvasElement>) =>
    cellAtPoint(e.currentTarget, layout.current, plan.width, plan.height, e.clientX, e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const cell = cellOf(e);
    if (!cell || (e.button !== 0 && e.button !== 2)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t: Tool = e.button === 2 ? 'erase' : tool;
    drag.current = { tool: t, start: cell, last: cell, changed: false };
    if (t !== 'room') drag.current.changed = paint(cell[0], cell[1], t, brush);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const cell = cellOf(e);
    hover.current = cell;
    const d = drag.current;
    if (!d || !cell) return;
    if (d.tool !== 'room') {
      for (const [x, y] of lineCells(d.last[0], d.last[1], cell[0], cell[1])) {
        if (paint(x, y, d.tool, brush)) d.changed = true;
      }
    }
    d.last = cell;
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    if (d.tool === 'room') {
      const [x0, y0] = d.start;
      const [x1, y1] = d.last;
      for (const [a, b, c, e] of [
        [x0, y0, x1, y0],
        [x0, y1, x1, y1],
        [x0, y0, x0, y1],
        [x1, y0, x1, y1],
      ]) {
        for (const [x, y] of lineCells(a, b, c, e)) if (paint(x, y, 'wall', 1)) d.changed = true;
      }
    }
    drag.current = null;
    if (d.changed) onCommit(working.current.slice());
  };

  return (
    <canvas
      ref={canvasRef}
      className="view-canvas editor-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => (hover.current = null)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Top-left cell of a size×size brush centred on `cell`. */
function brushOrigin([x, y]: [number, number], size: number): [number, number] {
  const half = Math.floor((size - 1) / 2);
  return [x - half, y - half];
}
