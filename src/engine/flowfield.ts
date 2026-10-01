/** 8-connected moves as [dx, dy, length]. */
export const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Dijkstra distance (in cells) from every cell to the nearest target, moving 8-way without cutting
 * wall corners. Blocked cells are impassable; stepping through cell j costs (1 + extraCost[j]) per
 * cell of length. Unreachable cells are Infinity.
 */
export function computeFlowField(
  width: number,
  height: number,
  blocked: Uint8Array,
  targets: Iterable<number>,
  extraCost?: Float32Array,
  out?: Float64Array,
): Float64Array {
  const dist = out ?? new Float64Array(width * height);
  dist.fill(Infinity);
  const heap = new MinHeap();
  for (const t of targets) {
    if (!blocked[t]) {
      dist[t] = 0;
      heap.push(t, 0);
    }
  }
  while (heap.size > 0) {
    const d = heap.peekPriority();
    const i = heap.pop();
    if (d > dist[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy, len] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (blocked[j]) continue;
      if (dx !== 0 && dy !== 0 && (blocked[y * width + nx] || blocked[ny * width + x])) continue;
      const nd = d + len * (1 + (extraCost ? extraCost[j] : 0));
      if (nd < dist[j]) {
        dist[j] = nd;
        heap.push(j, nd);
      }
    }
  }
  return dist;
}

class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  peekPriority(): number {
    return this.prios[0];
  }

  push(item: number, prio: number): void {
    let k = this.items.length;
    this.items.push(item);
    this.prios.push(prio);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.prios[p] <= prio) break;
      this.items[k] = this.items[p];
      this.prios[k] = this.prios[p];
      k = p;
    }
    this.items[k] = item;
    this.prios[k] = prio;
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prios.pop()!;
    const n = this.items.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && this.prios[c + 1] < this.prios[c]) c++;
        if (this.prios[c] >= lastPrio) break;
        this.items[k] = this.items[c];
        this.prios[k] = this.prios[c];
        k = c;
      }
      this.items[k] = lastItem;
      this.prios[k] = lastPrio;
    }
    return top;
  }
}
