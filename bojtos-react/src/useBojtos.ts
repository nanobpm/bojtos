import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActivateInstruction,
  type AgentResult,
  type BojtosSession,
  createBojtosSession,
  type DispatchOptions,
  dispatchRound,
  dispatchWorkers,
  type JobHandler,
  type RoundResult,
  type Snapshot,
  type WasmEvent,
  type WasmSource,
} from "@nanobpm/bojtos-kit";
import { bpmnKey } from "./runState.js";

/** Lifecycle of the in-browser engine load. */
export type BojtosPhase = "loading" | "ready" | "error";

export interface UseBojtosOptions {
  /**
   * The BPMN to deploy. Re-deploys on a fresh engine when it changes.
   *
   * Pass an array to deploy several resources into one engine — a called
   * process alongside its parent, say. `processIds` then lists every deployable
   * process across all of them, in deployment order.
   */
  bpmn: string | string[];
  /**
   * Optional engine wasm source. Pass a `URL` / bytes / `WebAssembly.Module`
   * when the default `import.meta.url` loader can't resolve the binary (the
   * external-`.wasm` "wasmUrl" mode, or a non-Vite bundler — ADR 0043 §3).
   *
   * Init-time only: the wasm module loads once per page (see `ensureWasm`), so
   * changing `wasm` after the first successful init has no effect — it will not
   * reload the module.
   */
  wasm?: WasmSource;
  /**
   * Cap the reactive `events` log at the most recent N entries.
   *
   * Every command re-reads the engine's full event log into React state, so a
   * long-running demo copies an ever-growing array on each step. Set this when
   * a page runs for a while and only shows a tail; leave it unset to keep the
   * whole log, which stays the default so existing consumers are unaffected.
   */
  maxEvents?: number;
}

export interface BojtosControls {
  phase: BojtosPhase;
  error: string | null;
  /** Deployable process ids from the current deployment. */
  processIds: string[];
  /** The latest snapshot, or `null` before the first command / after a reset. */
  snapshot: Snapshot | null;
  /** The engine's full event log after the latest command. */
  events: WasmEvent[];
  /** Start an instance; returns the post-run snapshot (with `created`) or null. */
  createInstance(processId: string, variablesJson: string): Snapshot | null;
  /** Complete a waiting job, merging output variables. */
  completeJob(jobKey: string, variablesJson: string): Snapshot | null;
  /**
   * Complete an ad-hoc sub-process's **agent** job with an {@link AgentResult}
   * (activate tools this turn / signal completion / merge variables). For the
   * usual dispatch-loop case, register agents via `runWorkers`/`stepWorkers`
   * `opts.agents` instead of calling this directly.
   */
  completeAgentJob(jobKey: string, result: AgentResult): Snapshot | null;
  /** Fail a waiting job (raises an incident with no retries left). */
  failJob(jobKey: string, retries: number, message: string): Snapshot | null;
  /**
   * Correlate a message to an instance parked at a message catch/receive:
   * publishes `messageName` with `correlationKey` and merges `variablesJson`.
   * The in-browser equivalent of an app publishing a message — used to unblock
   * a waiting loop (e.g. urban-pr-review's `review-ready`).
   */
  correlateMessage(
    messageName: string,
    correlationKey: string,
    variablesJson: string,
  ): Snapshot | null;
  /** Advance the virtual clock. */
  advanceTime(byMs: number): Snapshot | null;
  /**
   * Throw a BPMN business error from a waiting job: interrupts the activity via
   * a matching error boundary/event-subprocess catch, or raises an incident if
   * uncaught. The job is consumed either way.
   */
  throwError(
    jobKey: string,
    errorCode: string,
    errorMessage: string,
  ): Snapshot | null;
  /**
   * Set a job's remaining retries. Used to recover a job parked on a no-retries
   * incident before resolving that incident; does not itself unblock the job.
   */
  updateRetries(jobKey: string, retries: number): Snapshot | null;
  /**
   * Resolve an open incident by key, retrying the work that failed. Pair with
   * {@link updateRetries} to make a failed job activatable again — the
   * incident/retry loop a demo needs to show recovery.
   */
  resolveIncident(incidentKey: string): Snapshot | null;
  /**
   * Merge variables into a scope (a process-instance or element-instance key).
   * With `local`, they are written strictly into that scope; otherwise they
   * propagate up to the nearest ancestor defining each name.
   */
  setVariables(
    scopeKey: string,
    variablesJson: string,
    local: boolean,
  ): Snapshot | null;
  /** Broadcast a signal by name to every matching open subscription. */
  broadcastSignal(signalName: string, variablesJson: string): Snapshot | null;
  /** Cancel (terminate) a running process instance. */
  cancelInstance(instanceKey: string): Snapshot | null;
  /**
   * Modify a running instance: terminate element instances and/or activate new
   * ones (Zeebe "modify process instance").
   */
  modify(
    instanceKey: string,
    activateInstructions: ActivateInstruction[],
    terminateElementInstanceKeys: string[],
  ): Snapshot | null;
  /**
   * Complete a waiting user task, merging output variables.
   *
   * A `userTask` produces no job, so the dispatch loop cannot advance one: this
   * is the only way a model with a human step reaches its end event. Drive it
   * from `snapshot.userTasks`.
   */
  completeUserTask(userTaskKey: string, variablesJson: string): Snapshot | null;
  /**
   * Assign a user task. With `allowOverride` false the command is rejected if
   * the task already has an assignee.
   */
  assignUserTask(
    userTaskKey: string,
    assignee: string,
    allowOverride: boolean,
  ): Snapshot | null;
  /** Clear a user task's assignee. */
  unassignUserTask(userTaskKey: string): Snapshot | null;
  /**
   * Update a user task's attributes from a JSON changeset (`candidateGroups`,
   * `candidateUsers`, `dueDate`, `followUpDate`, `priority`).
   */
  updateUserTask(userTaskKey: string, changesetJson: string): Snapshot | null;
  /**
   * Run the registered worker handlers until the process settles (activate →
   * handler → complete/fail), then reflect the resulting snapshot/events.
   * Register ad-hoc **agent** handlers via `opts.agents` to drive
   * `adHocSubProcess` tool activation in the same loop. Resolves to the settled
   * snapshot, or null if there is no live session.
   */
  runWorkers(
    workers: Record<string, JobHandler>,
    opts?: DispatchOptions,
  ): Promise<Snapshot | null>;
  /**
   * Run a single activate-and-handle pass of the registered workers (one
   * {@link dispatchRound}), reflecting the resulting snapshot/events. Returns
   * how many jobs it handled (0 once the process is quiescent) plus the
   * snapshot, or null if there is no live session — drive it on a timer to
   * animate the token advancing one step at a time.
   */
  stepWorkers(
    workers: Record<string, JobHandler>,
    opts?: DispatchOptions,
  ): Promise<RoundResult | null>;
  /** Re-deploy the diagram on the existing engine, clearing run state. */
  reset(): void;
}

/**
 * Session members the hook deliberately does not re-export: the deployment
 * lifecycle it owns itself, and the low-level activate primitive the dispatch
 * loop owns.
 */
type NotReExported = "deploy" | "free" | "activateJobs";

/**
 * Compile-time guard. `useBojtos` keeps its session private, so a command it
 * doesn't re-export is *unreachable* for a consumer rather than merely
 * inconvenient — which is how `completeUserTask` went missing and left any model
 * with a user task unfinishable (#1).
 *
 * Adding a command to {@link BojtosSession} without a binding here now fails the
 * build with the offending name, instead of shipping a hole.
 */
type UnboundCommands = Exclude<
  keyof BojtosSession,
  NotReExported | keyof BojtosControls
>;
type AssertNever<T extends never> = T;
type _EverySessionCommandIsBound = AssertNever<UnboundCommands>;

/**
 * React binding over a headless {@link BojtosSession}: owns the engine's
 * lifecycle and the reactive `snapshot` / `events` / `processIds` state, and
 * exposes the engine commands. The consuming component owns its own form state
 * (selected process, seed vars, per-job output) and drives the visual contract
 * (`<BpmnRuntimeView>` + the variable payload) off `snapshot`.
 *
 * This is the reactive half of the Bojtos public API (ADR 0043 §2); the console
 * test-run panel is its first consumer (§8 step 2 — dogfooding is the acceptance
 * test).
 */
export function useBojtos({
  bpmn,
  wasm,
  maxEvents,
}: UseBojtosOptions): BojtosControls {
  const sessionRef = useRef<BojtosSession | null>(null);
  const [phase, setPhase] = useState<BojtosPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [processIds, setProcessIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<WasmEvent[]>([]);

  // The wasm source is an init-time concern (the first `ensureWasm` wins), so
  // keep it in a ref rather than the mount effect's deps — a fresh URL/bytes
  // identity each render must not re-create the session.
  const wasmRef = useRef(wasm);
  wasmRef.current = wasm;

  // An array prop has a fresh identity every render, which would re-create the
  // engine on each one. Key the deploy effect on the content instead — see
  // `bpmnKey` for why this is a boundary-preserving serialization, not a join.
  const deployKey = bpmnKey(bpmn);
  const bpmnRef = useRef(bpmn);
  bpmnRef.current = bpmn;

  // Trim the reactive event log when the consumer asked for a cap.
  const maxEventsRef = useRef(maxEvents);
  maxEventsRef.current = maxEvents;
  const readEvents = useCallback((session: BojtosSession): WasmEvent[] => {
    const all = session.events();
    const cap = maxEventsRef.current;
    return cap !== undefined && cap >= 0 && all.length > cap
      ? all.slice(all.length - cap)
      : all;
  }, []);

  const deployInto = useCallback(
    (session: BojtosSession) => {
      const resources = Array.isArray(bpmnRef.current)
        ? bpmnRef.current
        : [bpmnRef.current];
      // Deploy in order, collecting every deployable process id. A later
      // resource can reference an earlier one (a call activity's child).
      const ids: string[] = [];
      for (const xml of resources) ids.push(...session.deploy(xml).processIds);
      setProcessIds(ids);
      setSnapshot(null);
      setEvents([]);
      setError(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployKey],
  );

  useEffect(() => {
    let cancelled = false;
    // A new diagram means a fresh engine: drop back to `loading` and clear the
    // previous session's state — including `processIds` — so consumers never
    // see `ready` (or a stale process list) against a freed session while the
    // new one is still loading.
    setPhase("loading");
    setProcessIds([]);
    setSnapshot(null);
    setEvents([]);
    setError(null);
    createBojtosSession({ wasm: wasmRef.current })
      .then((session) => {
        if (cancelled) {
          session.free();
          return;
        }
        try {
          deployInto(session);
        } catch (e) {
          // A failed deploy (e.g. invalid BPMN) must free the just-created
          // engine rather than leak it until unmount, and must not be stored
          // as the active session.
          session.free();
          setError(String(e));
          setPhase("error");
          return;
        }
        sessionRef.current = session;
        setPhase("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
      sessionRef.current?.free();
      sessionRef.current = null;
    };
  }, [deployInto]);

  const run = useCallback(
    (fn: (s: BojtosSession) => Snapshot): Snapshot | null => {
      const session = sessionRef.current;
      if (!session) return null;
      try {
        const snap = fn(session);
        setSnapshot(snap);
        setEvents(readEvents(session));
        setError(null);
        return snap;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const createInstance = useCallback(
    (processId: string, variablesJson: string) =>
      run((s) => s.createInstance(processId, variablesJson)),
    [run],
  );
  const completeJob = useCallback(
    (jobKey: string, variablesJson: string) =>
      run((s) => s.completeJob(jobKey, variablesJson)),
    [run],
  );
  const completeAgentJob = useCallback(
    (jobKey: string, result: AgentResult) =>
      run((s) => s.completeAgentJob(jobKey, result)),
    [run],
  );
  const failJob = useCallback(
    (jobKey: string, retries: number, message: string) =>
      run((s) => s.failJob(jobKey, retries, message)),
    [run],
  );
  const advanceTime = useCallback(
    (byMs: number) => run((s) => s.advanceTime(byMs)),
    [run],
  );
  const correlateMessage = useCallback(
    (messageName: string, correlationKey: string, variablesJson: string) =>
      run((s) => s.correlateMessage(messageName, correlationKey, variablesJson)),
    [run],
  );
  const throwError = useCallback(
    (jobKey: string, errorCode: string, errorMessage: string) =>
      run((s) => s.throwError(jobKey, errorCode, errorMessage)),
    [run],
  );
  const updateRetries = useCallback(
    (jobKey: string, retries: number) =>
      run((s) => s.updateRetries(jobKey, retries)),
    [run],
  );
  const resolveIncident = useCallback(
    (incidentKey: string) => run((s) => s.resolveIncident(incidentKey)),
    [run],
  );
  const setVariables = useCallback(
    (scopeKey: string, variablesJson: string, local: boolean) =>
      run((s) => s.setVariables(scopeKey, variablesJson, local)),
    [run],
  );
  const broadcastSignal = useCallback(
    (signalName: string, variablesJson: string) =>
      run((s) => s.broadcastSignal(signalName, variablesJson)),
    [run],
  );
  const cancelInstance = useCallback(
    (instanceKey: string) => run((s) => s.cancelInstance(instanceKey)),
    [run],
  );
  const modify = useCallback(
    (
      instanceKey: string,
      activateInstructions: ActivateInstruction[],
      terminateElementInstanceKeys: string[],
    ) =>
      run((s) =>
        s.modify(
          instanceKey,
          activateInstructions,
          terminateElementInstanceKeys,
        ),
      ),
    [run],
  );
  const completeUserTask = useCallback(
    (userTaskKey: string, variablesJson: string) =>
      run((s) => s.completeUserTask(userTaskKey, variablesJson)),
    [run],
  );
  const assignUserTask = useCallback(
    (userTaskKey: string, assignee: string, allowOverride: boolean) =>
      run((s) => s.assignUserTask(userTaskKey, assignee, allowOverride)),
    [run],
  );
  const unassignUserTask = useCallback(
    (userTaskKey: string) => run((s) => s.unassignUserTask(userTaskKey)),
    [run],
  );
  const updateUserTask = useCallback(
    (userTaskKey: string, changesetJson: string) =>
      run((s) => s.updateUserTask(userTaskKey, changesetJson)),
    [run],
  );

  const runWorkers = useCallback(
    async (
      workers: Record<string, JobHandler>,
      opts?: DispatchOptions,
    ): Promise<Snapshot | null> => {
      const session = sessionRef.current;
      if (!session) return null;
      try {
        const { snapshot: settled } = await dispatchWorkers(
          session,
          workers,
          opts,
        );
        // The session may have been torn down/replaced (bpmn change, unmount)
        // while we awaited — don't publish stale state or read a freed session.
        if (sessionRef.current !== session) return null;
        setSnapshot(settled);
        setEvents(readEvents(session));
        setError(null);
        return settled;
      } catch (e) {
        if (sessionRef.current !== session) return null;
        // Reflect whatever state the engine reached before the drain aborted
        // (e.g. the maxRounds guard) so the view isn't left stale.
        setSnapshot(session.snapshot());
        setEvents(readEvents(session));
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const stepWorkers = useCallback(
    async (
      workers: Record<string, JobHandler>,
      opts?: DispatchOptions,
    ): Promise<RoundResult | null> => {
      const session = sessionRef.current;
      if (!session) return null;
      try {
        const round = await dispatchRound(session, workers, opts);
        // Bail if the session was replaced/freed while we awaited the round.
        if (sessionRef.current !== session) return null;
        setSnapshot(round.snapshot);
        setEvents(readEvents(session));
        setError(null);
        return round;
      } catch (e) {
        if (sessionRef.current !== session) return null;
        setSnapshot(session.snapshot());
        setEvents(readEvents(session));
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      // Wipe the engine to its pristine state, then redeploy the diagram, so a
      // re-run starts from zero instances/completions rather than accumulating
      // across runs (a plain redeploy leaves prior instances resident).
      session.reset();
      deployInto(session);
    } catch (e) {
      setError(String(e));
    }
  }, [deployInto]);

  return {
    phase,
    error,
    processIds,
    snapshot,
    events,
    createInstance,
    completeJob,
    completeAgentJob,
    failJob,
    advanceTime,
    correlateMessage,
    throwError,
    updateRetries,
    resolveIncident,
    setVariables,
    broadcastSignal,
    cancelInstance,
    modify,
    completeUserTask,
    assignUserTask,
    unassignUserTask,
    updateUserTask,
    runWorkers,
    stepWorkers,
    reset,
  };
}
