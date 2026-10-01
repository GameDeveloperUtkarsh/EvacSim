import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecommendResult, Scenario } from '../engine/recommend';
import type { RecommendMessage, RecommendRequest } from '../engine/recommend.worker';
import type { FloorPlan } from '../engine/types';

export type RecommendState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: RecommendResult; plan: FloorPlan; scenario: Scenario }
  | { status: 'error'; message: string };

/** Runs the fix search in a Web Worker. Starting again (or `clear`) cancels a search in progress. */
export function useRecommendations() {
  const [state, setState] = useState<RecommendState>({ status: 'idle' });
  const worker = useRef<Worker | null>(null);

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
  };

  const start = useCallback((plan: FloorPlan, scenario: Scenario) => {
    stop();
    const w = new Worker(new URL('../engine/recommend.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setState({ status: 'running', done: 0, total: 1 });
    w.onmessage = (e: MessageEvent<RecommendMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') setState({ status: 'running', done: msg.done, total: msg.total });
      else {
        setState(
          msg.type === 'done'
            ? { status: 'done', result: msg.result, plan, scenario }
            : { status: 'error', message: msg.message },
        );
        stop();
      }
    };
    w.onerror = (e) => {
      setState({ status: 'error', message: e.message || 'The fix search failed.' });
      stop();
    };
    w.postMessage({ plan, scenario } satisfies RecommendRequest);
  }, []);

  const clear = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, []);

  useEffect(() => stop, []);

  return { state, start, clear };
}
