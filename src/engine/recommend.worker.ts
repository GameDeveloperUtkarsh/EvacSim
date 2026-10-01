import { recommend, type RecommendResult, type Scenario } from './recommend';
import type { FloorPlan } from './types';

export interface RecommendRequest {
  plan: FloorPlan;
  scenario: Scenario;
}

export type RecommendMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: RecommendResult }
  | { type: 'error'; message: string };

// Runs the fix search off the main thread so the UI stays responsive.
const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<RecommendRequest>) => {
  const post = (msg: RecommendMessage) => ctx.postMessage(msg);
  try {
    const result = recommend(e.data.plan, e.data.scenario, (done, total) => post({ type: 'progress', done, total }));
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
