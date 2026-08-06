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
import {
  describeRunState,
  markerKey,
  bpmnKey,
  resourceList,
  capEvents,
} from "../dist/runState.js";

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
  // The lone-string case passes through verbatim (no needless re-walk).
  assert.equal(bpmnKey("<a/>"), "<a/>");
});

test("resourceList normalizes to an ordered list, preserving order", () => {
  assert.deepEqual(resourceList("<a/>"), ["<a/>"]);
  assert.deepEqual(resourceList(["<a/>", "<b/>"]), ["<a/>", "<b/>"]);
  // Order is significant — a later resource can reference an earlier one.
  assert.deepEqual(resourceList(["<b/>", "<a/>"]), ["<b/>", "<a/>"]);
  // A single-element array and a concatenated string are *not* the same list.
  assert.deepEqual(resourceList(["<a/><b/>"]), ["<a/><b/>"]);
  assert.notDeepEqual(resourceList(["<a/><b/>"]), resourceList(["<a/>", "<b/>"]));
});

test("capEvents keeps the most recent up to the cap", () => {
  const all = [1, 2, 3, 4, 5];
  // No cap: undefined or negative means keep everything.
  assert.equal(capEvents(all, undefined), all);
  assert.equal(capEvents(all, -1), all);
  // cap >= length: keep everything (same array, no needless copy).
  assert.equal(capEvents(all, 5), all);
  assert.equal(capEvents(all, 10), all);
  // 0 keeps nothing.
  assert.deepEqual(capEvents(all, 0), []);
  // A cap below length keeps the most recent, oldest-first order preserved.
  assert.deepEqual(capEvents(all, 2), [4, 5]);
  // The input is never mutated.
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
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
