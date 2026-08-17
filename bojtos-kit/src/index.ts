// @nanobpm/bojtos-kit — the framework-agnostic core of the Bojtos demo
// framework (ADR 0043). Wraps the in-browser wasm engine as a single scenario
// runner and re-exports the engine's snapshot/event contract types.

export {
  ensureWasm,
  createBojtosSession,
  type BojtosSession,
  type WasmSource,
} from "./session.js";
export {
  dispatchWorkers,
  dispatchRound,
  settleReason,
  unhandledJobTypes,
  JobFailure,
  type JobHandler,
  type JobResult,
  type AgentHandler,
  type DispatchOptions,
  type DispatchResult,
  type RoundResult,
  type SettleReason,
} from "./worker.js";
// The shared trace model + both adapters (engine-event fold and handler-emitted
// `TraceEntry`) that retired the two forked `TraceTimeline` copies (#9). Pure and
// React-free — the presentational component lives in @nanobpm/bojtos-react.
export {
  buildTraceItems,
  isTraceTurnGroup,
  foldEngineEvents,
  traceEntriesToRows,
} from "./trace.js";
export type {
  TraceRowKind,
  TraceEntry,
  TraceRow,
  TraceTurnGroup,
  TraceItem,
  TraceAdapter,
} from "./trace.js";
// Every type reachable from `Snapshot` is exported: a consumer that can read
// `snapshot.userTasks` must also be able to name `UserTaskDto` to write a
// helper for it. Keep this list exhaustive when adding to `types.ts`.
export type {
  Snapshot,
  InstanceDto,
  JobDto,
  ActivatedJob,
  IncidentDto,
  TimerDto,
  UserTaskDto,
  MessageSubscriptionDto,
  SignalSubscriptionDto,
  ElementStatDto,
  SequenceFlowDto,
  DecisionInstanceDto,
  ActiveEl,
  ActivateInstruction,
  AgentActivation,
  AgentResult,
  WasmEvent,
} from "./types.js";
