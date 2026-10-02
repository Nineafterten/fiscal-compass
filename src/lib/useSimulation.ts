/**
 * Runs the Monte Carlo simulation in a worker, keyed to the current plan.
 *
 * Two behaviours make this usable while dragging a slider:
 *
 *  - **Debounced.** A drag produces dozens of plan states per second; only the
 *    one you land on is worth ~1.5s of simulation.
 *  - **Stale-while-revalidate.** The previous result stays on screen while the
 *    next is computing, so charts dim rather than disappearing. A chart that
 *    blanks on every keystroke is worse than one that's briefly out of date.
 */

import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../types/plan';
import type { MonteCarloResult, RetirementAgePoint } from './engine/montecarlo';
import type { WorkerRequest, WorkerResponse } from './engine/worker';

export interface SimulationState {
  status: 'idle' | 'running' | 'ready' | 'error';
  /** 0–1 within the current stage. */
  progress: number;
  stage: 'simulation' | 'curve';
  simulation?: MonteCarloResult;
  curve?: RetirementAgePoint[];
  elapsedMs?: number;
  error?: string;
  /** True when what's displayed predates the current plan. */
  stale: boolean;
}

const INITIAL: SimulationState = {
  status: 'idle',
  progress: 0,
  stage: 'simulation',
  stale: false,
};

export function useSimulation(plan: Plan | undefined, debounceMs = 400): SimulationState {
  const [state, setState] = useState<SimulationState>(INITIAL);
  const workerRef = useRef<Worker>();
  const requestIdRef = useRef(0);

  // One worker for the lifetime of the hook.
  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    const worker = new Worker(new URL('./engine/worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      // A worker can't interrupt its own loop, so superseded runs finish and
      // are discarded here by id.
      if (message.id !== requestIdRef.current) return;

      if (message.type === 'progress') {
        setState((prev) => ({
          ...prev,
          status: 'running',
          progress: message.fraction,
          stage: message.stage,
        }));
      } else if (message.type === 'result') {
        setState({
          status: 'ready',
          progress: 1,
          stage: 'curve',
          simulation: message.simulation,
          curve: message.curve,
          elapsedMs: message.elapsedMs,
          stale: false,
        });
      } else {
        setState((prev) => ({ ...prev, status: 'error', error: message.message }));
      }
    };

    worker.onerror = (event) => {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: event.message || 'Simulation worker failed',
      }));
    };

    return () => {
      worker.terminate();
      workerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!plan || !workerRef.current) return;

    setState((prev) => ({ ...prev, status: 'running', progress: 0, stale: true }));

    const timer = setTimeout(() => {
      const id = ++requestIdRef.current;
      const request: WorkerRequest = {
        type: 'run',
        id,
        plan,
        runs: plan.assumptions.simulationRuns,
        curveRuns: 300,
      };
      workerRef.current?.postMessage(request);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [plan, debounceMs]);

  return state;
}
