// The shared trace model + both adapters (nanobpm/bojtos#9).
//
// Two forked `TraceTimeline` copies drifted apart because the fold logic lived
// inside each consumer's component. These tests pin the single shared model: the
// turn-grouping fold, and both adapters — the engine-event fold (the non-agentic
// test-view case) and the handler-emitted `TraceEntry` adapter (the agentic
// turn-grouped card case).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTraceItems,
  isTraceTurnGroup,
  foldEngineEvents,
  traceEntriesToRows,
  type TraceEntry,
  type TraceItem,
  type TraceTurnGroup,
  type WasmEvent,
} from "../dist/index.js";

function groups(items: TraceItem[]): TraceTurnGroup[] {
  return items.filter(isTraceTurnGroup);
}

test("buildTraceItems folds consecutive same-turn rows into one group", () => {
  const rows = traceEntriesToRows([
    { kind: "start", text: "started" },
    { kind: "llm", text: "reply A", turn: 1 },
    { kind: "agent", text: "call tool", turn: 1, elementId: "Tool_1" },
    { kind: "vars", text: "result", turn: 1, elementId: "Tool_1", result: { ok: true } },
    { kind: "llm", text: "reply B", turn: 2 },
    { kind: "done", text: "finished" },
  ]);
  const items = buildTraceItems(rows);

  // start (plain), turn 1 (group), turn 2 (group), done (plain).
  assert.equal(items.length, 4);
  assert.equal(isTraceTurnGroup(items[0]), false);
  assert.equal(isTraceTurnGroup(items[3]), false);

  const g = groups(items);
  assert.equal(g.length, 2);
  assert.equal(g[0].turn, 1);
  assert.equal(g[0].rows.length, 3);
  assert.equal(g[1].turn, 2);
  assert.equal(g[1].rows.length, 1);
});

test("buildTraceItems breaks a group on a non-turn row and reopens after it", () => {
  // A non-turn line interleaved between two same-turn runs must not be swallowed
  // into a card, and must not merge the two runs across it.
  const rows = traceEntriesToRows([
    { kind: "agent", text: "a", turn: 1 },
    { kind: "tool", text: "loose" }, // no turn — breaks the group
    { kind: "agent", text: "b", turn: 1 }, // same number, but a new group
  ]);
  const items = buildTraceItems(rows);
  assert.equal(items.length, 3);
  assert.equal(isTraceTurnGroup(items[0]), true);
  assert.equal(isTraceTurnGroup(items[1]), false);
  assert.equal(isTraceTurnGroup(items[2]), true);
  assert.equal(groups(items).length, 2);
});

test("buildTraceItems keeps a non-agentic (no-turn) log entirely flat", () => {
  const rows = traceEntriesToRows([
    { kind: "start", text: "s" },
    { kind: "tool", text: "t" },
    { kind: "done", text: "d" },
  ]);
  const items = buildTraceItems(rows);
  assert.equal(items.length, 3);
  assert.equal(groups(items).length, 0);
});

test("traceEntriesToRows stamps a stable, monotonic id and preserves fields", () => {
  const entries: TraceEntry[] = [
    { kind: "llm", text: "hi", turn: 3, pending: true },
    { kind: "agent", text: "tool", turn: 3, elementId: "T", args: { a: 1 } },
  ];
  const rows = traceEntriesToRows(entries);
  assert.deepEqual(
    rows.map((r) => r.id),
    [0, 1],
  );
  assert.equal(rows[0].pending, true);
  assert.equal(rows[1].elementId, "T");
  assert.deepEqual(rows[1].args, { a: 1 });
  // The input is never mutated.
  assert.equal((entries[0] as { id?: number }).id, undefined);
});

test("the handler-emitted adapter reproduces the turn-grouped card model", () => {
  // The agentic web-demo case: an LLM reply, a tool activation, and that tool's
  // result all sharing a turn — the view pairs the result to the activation by
  // elementId, so the fold must keep them in one group with those fields intact.
  const rows = traceEntriesToRows([
    { kind: "llm", text: "I'll check inventory", turn: 1 },
    { kind: "agent", text: "check", turn: 1, elementId: "CheckStock", args: { sku: "A1" } },
    { kind: "vars", text: "in stock", turn: 1, elementId: "CheckStock", result: { qty: 5 } },
  ]);
  const [item] = buildTraceItems(rows);
  assert.ok(isTraceTurnGroup(item));
  const group = item as TraceTurnGroup;
  const activation = group.rows.find((r) => r.kind === "agent");
  const result = group.rows.find((r) => r.kind === "vars");
  assert.equal(activation?.elementId, "CheckStock");
  assert.equal(result?.elementId, activation?.elementId);
  assert.deepEqual(result?.result, { qty: 5 });
});

// A realistic slice of the engine's flattened event stream for a one-service-task
// run (see `types.ts` — `{ seq, now, type, …snake_case }`). Includes low-signal
// lifecycle events the fold must drop.
const ENGINE_EVENTS: WasmEvent[] = [
  { seq: 1, now: 0, type: "DeploymentCreated", deployment_key: 1 },
  { seq: 2, now: 0, type: "ProcessDeployed", process_definition_key: 2 },
  { seq: 3, now: 0, type: "ProcessInstanceCreated", process_id: "one", instance_key: 3 },
  { seq: 4, now: 0, type: "ElementActivating", element_id: "s", instance_key: 3 },
  { seq: 5, now: 0, type: "ElementActivated", element_id: "s", instance_key: 3 },
  { seq: 6, now: 0, type: "ElementCompleted", element_id: "s", instance_key: 3 },
  { seq: 7, now: 0, type: "SequenceFlowTaken", from: "s", to: "work", instance_key: 3 },
  { seq: 8, now: 0, type: "JobCreated", element_id: "work", job_type: "work", job_key: 6 },
  { seq: 9, now: 0, type: "JobActivated", element_id: "work", job_type: "work", job_key: 6 },
  { seq: 10, now: 0, type: "JobCompleted", instance_key: 3, job_type: "work", job_key: 6 },
  { seq: 11, now: 0, type: "VariablesUpdated", instance_key: 3 },
  { seq: 12, now: 0, type: "ProcessInstanceCompleted", instance_key: 3 },
];

test("foldEngineEvents keeps only milestones and drops lifecycle noise", () => {
  const rows = foldEngineEvents(ENGINE_EVENTS);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["start", "tool", "vars", "done"],
  );
  // No `ElementActivating`/`ElementActivated`/`ElementCompleted`/`SequenceFlowTaken`/
  // `JobActivated`/`VariablesUpdated`/deployment rows leaked through.
  assert.equal(rows.length, 4);
});

test("foldEngineEvents renders readable text and carries the element id", () => {
  const rows = foldEngineEvents(ENGINE_EVENTS);
  assert.equal(rows[0].text, "Process one started");
  assert.equal(rows[1].text, "Job work activated on work");
  assert.equal(rows[1].elementId, "work");
  assert.equal(rows[2].text, "Job work completed");
  assert.equal(rows[3].text, "Process completed");
});

test("foldEngineEvents uses the event seq as a stable row id", () => {
  const rows = foldEngineEvents(ENGINE_EVENTS);
  assert.deepEqual(
    rows.map((r) => r.id),
    [3, 8, 10, 12],
  );
});

test("foldEngineEvents classifies incidents and user tasks", () => {
  const rows = foldEngineEvents([
    { seq: 1, now: 0, type: "ProcessInstanceCreated", process_id: "p" },
    { seq: 2, now: 0, type: "UserTaskCreated", element_id: "review" },
    { seq: 3, now: 5, type: "IncidentRaised", element_id: "pay", reason: "no retries" },
    { seq: 4, now: 6, type: "ProcessInstanceTerminated" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["start", "human", "error", "error"],
  );
  assert.equal(rows[2].text, "Incident on pay: no retries");
  assert.equal(rows[1].text, "User task review awaiting a human");
});

test("foldEngineEvents produces a flat item list (engine events carry no turn)", () => {
  const items = buildTraceItems(foldEngineEvents(ENGINE_EVENTS));
  assert.equal(groups(items).length, 0);
  assert.equal(items.length, 4);
});
