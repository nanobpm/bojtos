// @nanobpm/bojtos-react — the React binding for the Bojtos in-browser BPMN demo
// framework (ADR 0043). `useBojtos` owns the engine session and reactive state;
// `<BpmnRuntimeView>` renders the live token/incident diagram. The engine's
// snapshot/event contract types are re-exported from @nanobpm/bojtos-kit for
// convenience.

export {
  useBojtos,
  useReadModel,
  type UseBojtosOptions,
  type BojtosControls,
  type ReadModelBojtosControls,
  type BojtosPhase,
} from "./useBojtos.js";
export { Bojtos, type BojtosProps, type TraceEvent } from "./Bojtos.js";
export {
  OrderFulfillmentDemo,
  ORDER_FULFILLMENT_BPMN,
  orderFulfillmentWorkers,
} from "./examples/orderFulfillment.js";
export {
  BpmnRuntimeView,
  type BpmnRuntimeViewProps,
} from "./BpmnRuntimeView.js";
// The shared activity log (#9). Trace-only imports tree-shake bpmn-js out —
// TraceTimeline imports only the kit + React, never BpmnRuntimeView.
export { TraceTimeline, type TraceTimelineProps } from "./TraceTimeline.js";
export {
  describeRunState,
  markerKey,
  bpmnKey,
  resourceList,
  capEvents,
  resolveVariant,
  selectReadModel,
} from "./runState.js";
export {
  JobFailure,
  settleReason,
  unhandledJobTypes,
  buildTraceItems,
  isTraceTurnGroup,
  foldEngineEvents,
  traceEntriesToRows,
  type JobHandler,
  type JobResult,
  type AgentHandler,
  type DispatchOptions,
  type DispatchResult,
  type RoundResult,
  type SettleReason,
} from "@nanobpm/bojtos-kit";
export type {
  BojtosSession,
  ReadModelBojtosSession,
  EngineVariant,
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
  TraceRowKind,
  TraceEntry,
  TraceRow,
  TraceTurnGroup,
  TraceItem,
  TraceAdapter,
  UserTaskSearchQueryResult,
  UserTaskResult,
  ProcessInstanceSearchQueryResult,
  ProcessInstanceResult,
  VariableSearchQueryResult,
  VariableResult,
  FormResult,
  ResourceResult,
  SearchQueryResponse,
  SearchQueryPageResponse,
} from "@nanobpm/bojtos-kit";
