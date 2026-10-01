import { Cell, type CellType } from '../engine/types';

export type Tool = 'wall' | 'door' | 'exit' | 'erase' | 'room';

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'wall', label: 'Wall', key: '1', hint: 'Drag to paint walls' },
  { id: 'room', label: 'Room', key: '2', hint: 'Drag a rectangle to outline a room' },
  { id: 'door', label: 'Door', key: '3', hint: 'Paint over a wall to cut a door' },
  { id: 'exit', label: 'Exit', key: '4', hint: 'Paint exits on outer walls' },
  { id: 'erase', label: 'Erase', key: '5', hint: 'Back to open floor (or right-drag with any tool)' },
];

/** Cell type each painting tool writes. The room tool always draws walls. */
export const TOOL_CELL: Record<Tool, CellType> = {
  wall: Cell.Wall,
  room: Cell.Wall,
  door: Cell.Door,
  exit: Cell.Exit,
  erase: Cell.Floor,
};

/** Integer cells on the line from a to b (Bresenham), inclusive of both ends. */
export function lineCells(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  for (;;) {
    out.push([x, y]);
    if (x === bx && y === by) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
