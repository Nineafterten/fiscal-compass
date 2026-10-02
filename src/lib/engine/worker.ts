/// <reference lib="webworker" />

/**
 * Simulation worker.
 *
 * A full analysis is roughly 1.5s of arithmetic — fine in absolute terms, and
 * completely unacceptable on the main thread while someone is dragging a
 * slider. Running it here keeps the deterministic projection (sub-millisecond,
 * still synchronous) responsive while the probabilities catch up behind it.
 *
 * Superseded requests are abandoned by id rather than cancelled: a worker
 * can't interrupt a running loop, so the main thread simply ignores results
 * whose id is no longer current.
 */

import type { Plan } from '../../types/plan';
import {
  retirementAgeCurve,
  runMonteCarlo,
  type MonteCarloResult,
  type RetirementAgePoint,
} from './montecarlo';
import type { ProjectionOptions } from './project';

export interface WorkerRequest {
  type: 'run';
  id: number;
  plan: Plan;
  options?: ProjectionOptions;
  runs?: number;
  curveRuns?: number;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; fraction: number; stage: 'simulation' | 'curve' }
  | {
      type: 'result';
      id: number;
      simulation: MonteCarloResult;
      curve: RetirementAgePoint[];
      elapsedMs: number;
    }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request?.type !== 'run') return;

  const post = (message: WorkerResponse) => ctx.postMessage(message);
  const started = performance.now();

  try {
    // The fan chart needs full percentile bands, so it gets the higher run
    // count; the curve needs one number per age and can afford fewer.
    const simulation = runMonteCarlo(request.plan, {
      ...request.options,
      runs: request.runs ?? 1000,
      onProgress: (fraction) =>
        post({ type: 'progress', id: request.id, fraction, stage: 'simulation' }),
    });

    const curve = retirementAgeCurve(request.plan, {
      ...request.options,
      runs: request.curveRuns ?? 300,
      onProgress: (fraction) =>
        post({ type: 'progress', id: request.id, fraction, stage: 'curve' }),
    });

    post({
      type: 'result',
      id: request.id,
      simulation,
      curve,
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
