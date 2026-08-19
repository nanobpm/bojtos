import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ActivateInstruction,
  type AgentResult,
  type BojtosSession,
  createBojtosSession,
  type DispatchOptions,
  dispatchRound,
  dispatchWorkers,
  type EngineVariant,
  type FormResult,
  type JobHandler,
  type ProcessInstanceSearchQueryResult,
  type ReadModelBojtosSession,
  type ResourceResult,
  type RoundResult,
  type Snapshot,
  type UserTaskSearchQueryResult,
  type VariableSearchQueryResult,
  type WasmEvent,
  type WasmSource,
} from "@nanobpm/bojtos-kit";
import {
  bpmnKey,
  capEvents,
  resolveVariant,
  resourceList,
  selectReadModel,
} from "./runState.js";

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
  /**
   * Which engine variant to load, defaulting to `"lean"` — existing consumers
   * are unaffected. Pass `"readmodel"` to also thread the gateway's
   * Camunda-parity REST read channel through the hook: the returned controls
   * then widen to {@link ReadModelBojtosControls}, exposing `searchUserTasks` /
   * `searchProcessInstances` / `searchVariables` / `getFormByKey` /
   * `getResourceByKey` plus the `readModelVersion` reactivity signal.
   *
   * Init-time only, like `wasm`: the variant is read when the session is first
   * created for a given diagram, so changing it later has no effect until the
   * next `bpmn` change re-creates the engine.
   *
   * The read-model binary is heavier and only code-splits in when this is
   * `"readmodel"` (ADR 0043 §3); a lean hook never downloads it.
   */
  variant?: EngineVariant;
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
 * The {@link BojtosControls} of a `readmodel`-variant hook: the full command
 * surface **plus** reactive access to the gateway's Camunda-parity REST read
 * channel. You get one by passing `variant: "readmodel"` to {@link useBojtos},
 * which widens the return type from `BojtosControls` to this.
 *
 * ## Reactivity model
 *
 * The read queries are **pull** projections of the read model, not part of the
 * command→`snapshot` push loop: `searchUserTasks` et al. answer "what does the
 * read model say *right now*", and there is no single obvious cadence at which
 * to re-run them (a consumer may care about tasks, another about variables, each
 * with its own filter). So rather than eagerly re-running every query after
 * every command and stuffing five results into state, the hook exposes:
 *
 * - the five read methods as **imperative pulls** — call one whenever you want a
 *   fresh answer; each returns `null` before the engine is ready rather than
 *   throwing, and
 * - {@link readModelVersion}, a counter bumped after **every** command / worker
 *   round (i.e. whenever the read model may have moved), so a consumer can make
 *   a query reactive by keying a `useMemo`/`useEffect` on it — or just let
 *   {@link useReadModel} do exactly that.
 *
 * This keeps the read channel opt-in and filter-agnostic while still landing its
 * results in React state on the consumer's terms.
 */
export interface ReadModelBojtosControls extends BojtosControls {
  /**
   * Search user tasks through the read model (mirrors `POST
   * /user-tasks/search`). Returns `null` until the engine is ready. Honours an
   * optional `{ state? }` filter, e.g. `searchUserTasks('{"state":"CREATED"}')`.
   */
  searchUserTasks(filterJson?: string): UserTaskSearchQueryResult | null;
  /**
   * Search process instances through the read model (mirrors `POST
   * /process-instances/search`). Returns `null` until the engine is ready.
   */
  searchProcessInstances(
    filterJson?: string,
  ): ProcessInstanceSearchQueryResult | null;
  /**
   * Search variables through the read model (mirrors `POST
   * /variables/search`). Returns `null` until the engine is ready.
   */
  searchVariables(filterJson?: string): VariableSearchQueryResult | null;
  /**
   * The latest deployed form for `formKey` (mirrors `GET /forms/{formKey}`), or
   * `null` if none exists — also `null` until the engine is ready.
   */
  getFormByKey(formKey: string): FormResult | null;
  /**
   * The generic resource for `resourceKey` (mirrors `GET
   * /resources/{resourceKey}`), or `null` if none exists — also `null` until the
   * engine is ready.
   */
  getResourceByKey(resourceKey: string): ResourceResult | null;
  /**
   * A monotonically increasing counter bumped after every command / worker round
   * (and on deploy / reset). It is the reactivity signal for the pull read
   * queries: key a `useMemo`/`useEffect` on it to re-run a query when the read
   * model may have changed. {@link useReadModel} is the ready-made selector over
   * it.
   */
  readModelVersion: number;
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
 * The same guard for the widened `readmodel` surface: every method of a
 * {@link ReadModelBojtosSession} — the lean commands **and** the five read
 * queries — must be bound on {@link ReadModelBojtosControls}, or a `readmodel`
 * hook would silently drop part of the read channel (the exact failure mode #1
 * described, now covering the read methods too). Adding a read query to the
 * session without binding it here fails the build with its name.
 */
type UnboundReadModelCommands = Exclude<
  keyof ReadModelBojtosSession,
  NotReExported | keyof ReadModelBojtosControls
>;
type _EveryReadModelCommandIsBound = AssertNever<UnboundReadModelCommands>;

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
 *
 * With `variant: "readmodel"` the return type widens to
 * {@link ReadModelBojtosControls}, adding the read channel + `readModelVersion`;
 * the default `"lean"` variant returns the plain {@link BojtosControls} and never
 * downloads the heavier read-model binary.
 */
export function useBojtos(
  options: UseBojtosOptions & { variant: "readmodel" },
): ReadModelBojtosControls;
export function useBojtos(
  options: UseBojtosOptions & { variant?: "lean" },
): BojtosControls;
export function useBojtos(
  options: UseBojtosOptions,
): BojtosControls | ReadModelBojtosControls;
export function useBojtos({
  bpmn,
  wasm,
  maxEvents,
  variant,
}: UseBojtosOptions): ReadModelBojtosControls {
  const sessionRef = useRef<BojtosSession | null>(null);
  // The same session, narrowed to its read channel, but only when we actually
  // asked for the `readmodel` variant. Kept as its own ref (rather than casting
  // `sessionRef`) so the read methods reach the query surface without a cast — a
  // lean session simply leaves this null and every read pull returns null.
  const readModelRef = useRef<ReadModelBojtosSession | null>(null);
  const [phase, setPhase] = useState<BojtosPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [processIds, setProcessIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<WasmEvent[]>([]);
  // Bumped whenever the read model may have moved (any command / round / deploy /
  // reset) so pull read queries can be made reactive by keying on it.
  const [readModelVersion, setReadModelVersion] = useState(0);
  const bumpReadModel = useCallback(
    () => setReadModelVersion((v) => v + 1),
    [],
  );

  // The variant is an init-time concern like `wasm` (read when a session is
  // first created for a diagram), so keep it in a ref rather than the deploy
  // effect's deps.
  const variantRef = useRef(variant);
  variantRef.current = variant;

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
    return capEvents(session.events(), maxEventsRef.current);
  }, []);

  const deployInto = useCallback(
    (session: BojtosSession) => {
      const resources = resourceList(bpmnRef.current);
      // Deploy in order, collecting every deployable process id. A later
      // resource can reference an earlier one (a call activity's child).
      const ids: string[] = [];
      for (const xml of resources) ids.push(...session.deploy(xml).processIds);
      setProcessIds(ids);
      setSnapshot(null);
      setEvents([]);
      setError(null);
      // The read model was just wiped and re-seeded by the redeploy, so any
      // reactive read query must re-run.
      bumpReadModel();
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
    // Resolve the session with the requested variant. The `readmodel` branch
    // keeps the narrowed `ReadModelBojtosSession` so the read methods reach the
    // query surface without a cast; the lean branch leaves `readModelRef` null.
    const variant = resolveVariant(variantRef.current);
    const pending =
      variant === "readmodel"
        ? createBojtosSession({ wasm: wasmRef.current, variant: "readmodel" })
        : createBojtosSession({ wasm: wasmRef.current });
    pending
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
        readModelRef.current =
          variant === "readmodel" ? (session as ReadModelBojtosSession) : null;
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
      readModelRef.current = null;
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
        // A command may have moved the read model; signal reactive readers.
        bumpReadModel();
        return snap;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [bumpReadModel, readEvents],
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
        bumpReadModel();
        return settled;
      } catch (e) {
        if (sessionRef.current !== session) return null;
        // Reflect whatever state the engine reached before the drain aborted
        // (e.g. the maxRounds guard) so the view isn't left stale.
        setSnapshot(session.snapshot());
        setEvents(readEvents(session));
        setError(String(e));
        bumpReadModel();
        return null;
      }
    },
    [bumpReadModel, readEvents],
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
        bumpReadModel();
        return round;
      } catch (e) {
        if (sessionRef.current !== session) return null;
        setSnapshot(session.snapshot());
        setEvents(readEvents(session));
        setError(String(e));
        bumpReadModel();
        return null;
      }
    },
    [bumpReadModel, readEvents],
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

  // The read channel. Each pull returns null when there is no live read-model
  // session (loading, or a lean-variant hook), via the shared `selectReadModel`
  // guard, rather than throwing on a missing engine. They intentionally do not
  // touch React state themselves — reactivity is opt-in through
  // `readModelVersion` / `useReadModel` (see `ReadModelBojtosControls`).
  const searchUserTasks = useCallback(
    (filterJson?: string) =>
      selectReadModel(readModelRef.current, (rm) =>
        rm.searchUserTasks(filterJson),
      ),
    [],
  );
  const searchProcessInstances = useCallback(
    (filterJson?: string) =>
      selectReadModel(readModelRef.current, (rm) =>
        rm.searchProcessInstances(filterJson),
      ),
    [],
  );
  const searchVariables = useCallback(
    (filterJson?: string) =>
      selectReadModel(readModelRef.current, (rm) =>
        rm.searchVariables(filterJson),
      ),
    [],
  );
  const getFormByKey = useCallback(
    (formKey: string) =>
      selectReadModel(readModelRef.current, (rm) => rm.getFormByKey(formKey)),
    [],
  );
  const getResourceByKey = useCallback(
    (resourceKey: string) =>
      selectReadModel(readModelRef.current, (rm) =>
        rm.getResourceByKey(resourceKey),
      ),
    [],
  );

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
    searchUserTasks,
    searchProcessInstances,
    searchVariables,
    getFormByKey,
    getResourceByKey,
    readModelVersion,
  };
}

/**
 * Reactively project a value out of a `readmodel` hook's read channel, re-run
 * whenever the read model may have moved.
 *
 * The read queries are pull projections (see {@link ReadModelBojtosControls}),
 * so this is the ready-made "selector" that lands their result in React state on
 * your terms: pass the `readmodel` {@link useBojtos} controls and a `select`
 * that calls whichever read methods you care about (with whatever filters), and
 * the memoized result re-computes each time `readModelVersion` bumps — i.e.
 * after every command / worker round / deploy / reset — or the load `phase`
 * flips. Before the engine is ready the read methods return `null`, so a
 * selector must tolerate nulls.
 *
 * ```tsx
 * const run = useBojtos({ bpmn, variant: "readmodel" });
 * const openTasks = useReadModel(
 *   run,
 *   (rm) => rm.searchUserTasks('{"state":"CREATED"}')?.items ?? [],
 * );
 * ```
 */
export function useReadModel<T>(
  controls: ReadModelBojtosControls,
  select: (controls: ReadModelBojtosControls) => T,
): T {
  // Keep the latest selector and controls without making them memo dependencies:
  // re-running is driven by the read model moving (`readModelVersion`) / readiness
  // (`phase`), not by a fresh inline selector or a fresh `controls` object literal
  // (`useBojtos` returns a new object each render, so depending on it directly would
  // re-run the selector on *every* parent re-render).
  const selectRef = useRef(select);
  selectRef.current = select;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  return useMemo(
    () => selectRef.current(controlsRef.current),
    [controls.readModelVersion, controls.phase],
  );
}
