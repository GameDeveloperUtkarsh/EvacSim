/** What occupies a grid cell. */
export const Cell = {
  Floor: 0,
  Wall: 1,
  Door: 2,
  Exit: 3,
} as const;
export type CellType = (typeof Cell)[keyof typeof Cell];

/**
 * A building floor rasterised onto a uniform grid.
 * Cell (x, y) is stored at index y * width + x and covers [x, x+1) × [y, y+1) in grid units.
 */
export interface FloorPlan {
  name: string;
  width: number;
  height: number;
  /** Metres per cell side. */
  cellSize: number;
  cells: Uint8Array;
}
