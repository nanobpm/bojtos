// The first tests in this package.
//
// `bojtos-react` had no test script and no tests, which is exactly where the
// missing-command bug (#1) lived. Rendering the hook needs a DOM stack this
// repo doesn't carry, so the approach here is to keep the decisions *outside*
// the component — pure functions the component calls — and test those. What
// remains untested is the React lifecycle itself (mount/cleanup, redeploy on a
// `bpmn` change, the session-identity guards around awaited rounds); that wants
// jsdom and is worth a follow-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRunState, markerKey, bpmnKey } from "../dist/runState.js";

test("markerKey is stable across fresh arrays with the same ids", () => {
  // The bug this guards: `snapshot?.activeElementIds ?? []` builds a new array
  // every render, so depending on identity re-painted every marker and
  // re-created every token overlay on each parent render.
  assert.equal(markerKey(["a", "b"], ["c"]), markerKey(["a", "b"], ["c"]));
  assert.notEqual(markerKey(["a"], []), markerKey(["b"], []));
  assert.notEqual(markerKey(["a"], []), markerKey([], ["a"]));
  // Order is significant — the engine's ordering is stable, and treating a
  // reorder as "no change" would be a silent lie.
  assert.notEqual(markerKey(["a", "b"], []), markerKey(["b", "a"], []));
});

test("bpmnKey is stable across fresh arrays but distinguishes real changes", () => {
  // Stable identity: a fresh array with the same content keys the same, so the
  // deploy effect doesn't re-create the engine every render.
  assert.equal(bpmnKey(["<a/>", "<b/>"]), bpmnKey(["<a/>", "<b/>"]));
  assert.equal(bpmnKey("<a/>"), bpmnKey("<a/>"));
  // A real content change must change the key.
  assert.notEqual(bpmnKey(["<a/>"]), bpmnKey(["<b/>"]));
  // Boundary-preserving: these collide under `join(" ")` ("<a/> <b/>" both
  // ways) but must not collide here, or a real BPMN change would be missed.
  assert.notEqual(bpmnKey(["<a/> ", "<b/>"]), bpmnKey(["<a/>", " <b/>"]));
  assert.notEqual(bpmnKey(["<a/>", "<b/>"]), bpmnKey(["<a/> <b/>"]));
});

test("describeRunState puts the run into words for a screen reader", () => {
  assert.equal(describeRunState([], []), "Nothing running");
  assert.equal(describeRunState(["Task_1"], []), "Running: Task_1");
  assert.equal(
    describeRunState(["Task_1", "Task_2"], []),
    "Running: Task_1, Task_2",
  );
  assert.equal(
    describeRunState(["Task_1"], ["Task_9"]),
    "Running: Task_1. Incident: Task_9",
  );
  assert.equal(describeRunState([], ["Task_9"]), "Incident: Task_9");
});

test("describeRunState uses supplied element names when it has them", () => {
  const names: Record<string, string> = { Task_1: "Check inventory" };
  assert.equal(
    describeRunState(["Task_1", "Task_2"], [], (id) => names[id] ?? id),
    "Running: Check inventory, Task_2",
  );
});
