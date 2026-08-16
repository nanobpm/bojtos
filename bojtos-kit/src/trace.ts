// The framework-agnostic trace model shared by the Bojtos demo framework and the
// console test-view — the single source that retired the two drifted, forked
// `TraceTimeline` copies (nanobpm/bojtos#9). It defines one normalized row/turn
// model plus the two adapters that map a source into it:
//
//   1. the **engine-event fold** — `WasmEvent[]` (from `useBojtos().events`) →
//      rows, covering the non-agentic / test-view case; and
//   2. the **handler-emitted `TraceEntry`** adapter — the agent/tool/turn entries
//      (with the additive `turn` grouping field) → rows, covering the agentic
//      web-demo case.
//
// It is deliberately React-free: the presentational component (`TraceTimeline` in
// `@nanobpm/bojtos-react`) renders this model, keeping the view layer thin.

import type { WasmEvent } from "./types.js";

/**
 * Semantic classification of a trace row, driving how the view styles it (the
 * `log-<kind>` class the two forked timelines already keyed off) and which
 * affordance it carries. Framework-agnostic — an engine-event fold and an
 * agentic handler stream both land in this shared vocabulary:
 *
 * - `start` — the run/instance began.
 * - `agent` — an agent decision, or a tool the agent activated this turn.
 * - `llm`   — a raw model reply.
 * - `tool`  — a tool/handler log line (a job running, a timer, a message).
 * - `human` — a user task awaiting or completed by a person.
 * - `done`  — the final outcome (the instance completed/terminated).
 * - `error` — a failure, incident, or thrown error.
 * - `vars`  — a variables/result update (e.g. what a tool returned).
 */
export type TraceRowKind =
  | "start"
  | "agent"
  | "llm"
  | "tool"
  | "human"
  | "done"
  | "error"
  | "vars";

/**
 * A source line before it is placed in the normalized model. This is the shape a
 * handler emits (the web-demo framework's `TraceEntry`): `kind`/`text` are all a
 * plain consumer needs; every other field is additive and safe to ignore.
 */
export interface TraceEntry {
  kind: TraceRowKind;
  /** The human-readable line. */
  text: string;
  /**
   * Stable id for an entry that updates in place — a streaming completion grows
   * one line rather than spamming forty.
   */
  key?: string;
  /** True while the entry is still being produced (renders a spinner). */
  pending?: boolean;
  /**
   * Groups every entry produced by one agent turn together (the streamed LLM
   * reply, each tool it activated, and that tool's result). Consecutive entries
   * sharing a `turn` fold into one turn card; entries with no `turn` render as
   * plain rows in their original order.
   */
  turn?: number;
  /** The BPMN element (tool or task) this entry concerns. */
  elementId?: string;
  /** Arguments supplied when activating a tool — the coerced values, not the raw reply. */
  args?: Record<string, unknown>;
  /** What a tool/handler returned, paired with its activation by `elementId`. */
  result?: unknown;
}

/**
 * A normalized row: a {@link TraceEntry} stamped with a stable, monotonic `id`.
 * The `id` is what the view keys off and what pairs a tool's result with its
 * activation and orders loose lines within a turn.
 */
export interface TraceRow extends TraceEntry {
  id: number;
}

/** Consecutive same-turn rows, folded into one group by {@link buildTraceItems}. */
export interface TraceTurnGroup {
  turn: number;
  rows: TraceRow[];
}

/** A top-level item the view renders: either a plain row or a turn group. */
export type TraceItem = TraceRow | TraceTurnGroup;

/** Narrow a {@link TraceItem} to a {@link TraceTurnGroup}. */
export function isTraceTurnGroup(item: TraceItem): item is TraceTurnGroup {
  return (item as TraceTurnGroup).rows !== undefined;
}

/**
 * An adapter maps a source (`WasmEvent[]`, a `TraceEntry[]`, …) into the shared
 * normalized row model. Both built-in adapters — {@link foldEngineEvents} and
 * {@link traceEntriesToRows} — satisfy this; a consumer can supply its own for a
 * bespoke source.
 */
export type TraceAdapter<TSource> = (source: TSource) => TraceRow[];

/**
 * Fold a flat list of normalized rows into the view model: consecutive rows
 * sharing a `turn` become one {@link TraceTurnGroup}; everything else stays a
 * plain row in its original order. A row with no `turn` breaks the current group,
 * so an interleaved non-turn line never gets swallowed into a card. This is the
 * grouping both forked timelines did by hand, lifted into the shared kit.
 */
export function buildTraceItems(rows: TraceRow[]): TraceItem[] {
  const items: TraceItem[] = [];
  let current: TraceTurnGroup | null = null;
  for (const row of rows) {
    if (row.turn !== undefined) {
      if (current && current.turn === row.turn) {
        current.rows.push(row);
      } else {
        current = { turn: row.turn, rows: [row] };
        items.push(current);
      }
    } else {
      current = null;
      items.push(row);
    }
  }
  return items;
}

/**
 * The handler-emitted `TraceEntry` adapter: stamp each entry with a stable `id`
 * (its index) to lift it into a {@link TraceRow}. The entries already carry the
 * additive `turn`/`elementId`/`args`/`result` fields, so {@link buildTraceItems}
 * over the result reproduces the agentic turn-grouped card view without any
 * re-forked grouping logic. The input is never mutated.
 */
export function traceEntriesToRows(entries: readonly TraceEntry[]): TraceRow[] {
  return entries.map((entry, id) => ({ ...entry, id }));
}

/**
 * How one engine event type folds into the trace: its row {@link TraceRowKind}
 * and a function turning the event's snake_case payload into a line. Returning
 * a mapping opts the event into the story; every type absent from the table
 * below is deliberately dropped as low-signal lifecycle noise (`ElementActivating`
 * / `ElementCompleting`, `JobActivated`, `SequenceFlowTaken`, the scoped-variable
 * and parallel-join bookkeeping), so the fold reads as a run's milestones rather
 * than a raw trace.
 */
interface EngineEventRule {
  kind: TraceRowKind;
  text: (ev: WasmEvent) => string;
}

/** Read a string field off a `WasmEvent`'s open payload, or `undefined`. */
function str(ev: WasmEvent, key: string): string | undefined {
  const v = ev[key];
  return typeof v === "string" ? v : undefined;
}

/** The element this event concerns, if it names one — for pairing/labelling. */
function elementOf(ev: WasmEvent): string | undefined {
  return str(ev, "element_id");
}

const ENGINE_EVENT_RULES: Record<string, EngineEventRule> = {
  ProcessInstanceCreated: {
    kind: "start",
    text: (ev) => `Process ${str(ev, "process_id") ?? "instance"} started`,
  },
  JobCreated: {
    kind: "tool",
    text: (ev) =>
      `Job ${str(ev, "job_type") ?? ""} activated`.trim() +
      (elementOf(ev) ? ` on ${elementOf(ev)}` : ""),
  },
  JobCompleted: {
    kind: "vars",
    text: (ev) => `Job ${str(ev, "job_type") ?? ""} completed`.trim(),
  },
  JobFailed: {
    kind: "error",
    text: (ev) => `Job ${str(ev, "job_type") ?? ""} failed`.trim(),
  },
  JobErrorThrown: {
    kind: "error",
    text: (ev) =>
      `Job threw error ${str(ev, "error_code") ?? ""}`.trim() +
      (elementOf(ev) ? ` on ${elementOf(ev)}` : ""),
  },
  IncidentRaised: {
    kind: "error",
    text: (ev) =>
      `Incident on ${elementOf(ev) ?? "instance"}` +
      (str(ev, "reason") ? `: ${str(ev, "reason")}` : ""),
  },
  IncidentResolved: {
    kind: "tool",
    text: (ev) => `Incident resolved on ${elementOf(ev) ?? "instance"}`,
  },
  UserTaskCreated: {
    kind: "human",
    text: (ev) => `User task ${elementOf(ev) ?? ""} awaiting a human`.trim(),
  },
  UserTaskAssigned: {
    kind: "human",
    text: (ev) =>
      `User task ${elementOf(ev) ?? ""} assigned`.trim() +
      (str(ev, "assignee") ? ` to ${str(ev, "assignee")}` : ""),
  },
  UserTaskCompleted: {
    kind: "human",
    text: (ev) => `User task ${elementOf(ev) ?? ""} completed`.trim(),
  },
  UserTaskCanceled: {
    kind: "human",
    text: (ev) => `User task ${elementOf(ev) ?? ""} canceled`.trim(),
  },
  TimerCreated: {
    kind: "tool",
    text: (ev) => `Timer set on ${elementOf(ev) ?? "instance"}`,
  },
  TimerTriggered: {
    kind: "tool",
    text: (ev) => `Timer fired on ${elementOf(ev) ?? "instance"}`,
  },
  MessagePublished: {
    kind: "tool",
    text: (ev) => `Message ${str(ev, "message_name") ?? ""} published`.trim(),
  },
  MessageCorrelated: {
    kind: "tool",
    text: (ev) => `Message ${str(ev, "message_name") ?? ""} correlated`.trim(),
  },
  SignalBroadcast: {
    kind: "tool",
    text: (ev) => `Signal ${str(ev, "signal_name") ?? ""} broadcast`.trim(),
  },
  SignalCorrelated: {
    kind: "tool",
    text: (ev) => `Signal ${str(ev, "signal_name") ?? ""} correlated`.trim(),
  },
  AdHocActivated: {
    kind: "agent",
    text: (ev) => `Ad-hoc sub-process ${elementOf(ev) ?? ""} activated`.trim(),
  },
  AdHocToolActivated: {
    kind: "agent",
    text: (ev) => `Tool ${elementOf(ev) ?? ""} activated`.trim(),
  },
  AdHocToolCompleted: {
    kind: "vars",
    text: (ev) => `Tool ${elementOf(ev) ?? ""} returned`.trim(),
  },
  AdHocCompleted: {
    kind: "agent",
    text: (ev) => `Ad-hoc sub-process ${elementOf(ev) ?? ""} completed`.trim(),
  },
  ProcessInstanceCompleted: {
    kind: "done",
    text: () => "Process completed",
  },
  ProcessInstanceTerminated: {
    kind: "error",
    text: () => "Process terminated",
  },
};

/**
 * The engine-event fold adapter: map a `WasmEvent[]` (the flattened
 * `{ seq, now, type, …snake_case }` stream from `useBojtos().events`) into
 * normalized rows, keeping only the meaningful milestones (see
 * {@link ENGINE_EVENT_RULES}). Each row's `id` is the event's `seq`, so ids stay
 * stable and monotonic across re-reads of a growing log. Engine events carry no
 * turn, so {@link buildTraceItems} over the result is a flat list of rows — the
 * non-agentic test-view shape.
 */
export function foldEngineEvents(events: readonly WasmEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const ev of events) {
    const rule = ENGINE_EVENT_RULES[ev.type];
    if (!rule) continue;
    rows.push({
      id: ev.seq,
      kind: rule.kind,
      text: rule.text(ev),
      elementId: elementOf(ev),
    });
  }
  return rows;
}
