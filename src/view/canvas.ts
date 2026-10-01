export interface GridLayout {
  /** CSS pixels per cell. */
  scale: number;
  /** CSS-pixel offset of the grid's top-left corner. */
  ox: number;
  oy: number;
}

/** Match the canvas backing store to its CSS size × devicePixelRatio and return the context in CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; cw: number; ch: number } {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch };
}

/** Fit a width×height grid centred in a cw×ch area with some padding. */
export function fitGrid(cw: number, ch: number, width: number, height: number, pad = 16): GridLayout {
  const scale = Math.max(0.1, Math.min((cw - 2 * pad) / width, (ch - 2 * pad) / height));
  return { scale, ox: (cw - width * scale) / 2, oy: (ch - height * scale) / 2 };
}

/** Grid cell under a client-space point, or null outside the grid. */
export function cellAtPoint(
  canvas: HTMLCanvasElement,
  layout: GridLayout,
  width: number,
  height: number,
  clientX: number,
  clientY: number,
): [number, number] | null {
  const rect = canvas.getBoundingClientRect();
  const gx = Math.floor((clientX - rect.left - layout.ox) / layout.scale);
  const gy = Math.floor((clientY - rect.top - layout.oy) / layout.scale);
  return gx >= 0 && gy >= 0 && gx < width && gy < height ? [gx, gy] : null;
}
