// `replayEvents` is the inverse of `events()`: a trace serialised out of one
// session must rebuild an identical simulation when replayed into another. These
// tests pin that round-trip and the "decode-or-throw, never half-apply" contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createBojtosSession,
  deployedProcessIds,
  dispatchWorkers,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/lean/nanobpmn_engine_bg.wasm"),
);

const ONE_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="one" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:serviceTask id="work"><bpmn:extensionElements><zeebe:taskDefinition type="work" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="work" />
    <bpmn:sequenceFlow id="f2" sourceRef="work" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;

async function runOne() {
  const session = await createBojtosSession({ wasm: wasmBytes });
  session.deploy(ONE_TASK_BPMN);
  session.createInstance("one", "{}");
  await dispatchWorkers(session, { work: () => ({ done: true }) });
  return session;
}

test("replayEvents rebuilds an identical simulation in a fresh session", async () => {
  const source = await runOne();
  const trace = source.events();
  const original = source.snapshot();
  source.free();

  const replayed = await createBojtosSession({ wasm: wasmBytes });
  const restored = replayed.replayEvents(trace);

  // The replayed snapshot matches the one the run produced...
  assert.equal(restored.completedInstances, original.completedInstances);
  assert.equal(restored.totalInstances, original.totalInstances);
  assert.equal(restored.eventCount, original.eventCount);
  // ...and the session now holds that state (replayEvents replaced it).
  assert.deepEqual(replayed.snapshot(), restored);
  // The event log itself round-trips.
  assert.deepEqual(replayed.events(), trace);
  replayed.free();
});

test("replayEvents overwrites whatever the session already held", async () => {
  const source = await runOne();
  const trace = source.events();
  const expected = source.snapshot();
  source.free();

  // A target whose state differs from the trace (two completed instances vs
  // one), so a replay that does nothing — or merges — cannot pass.
  const target = await runOne();
  target.createInstance("one", "{}");
  await dispatchWorkers(target, { work: () => ({ done: true }) });
  assert.equal(target.snapshot().completedInstances, 2);
  assert.notEqual(target.events().length, trace.length);

  const restored = target.replayEvents(trace);
  assert.equal(restored.completedInstances, expected.completedInstances);
  assert.equal(restored.totalInstances, expected.totalInstances);
  assert.equal(restored.eventCount, trace.length);
  assert.deepEqual(target.snapshot(), restored);
  // The event log is replaced wholesale, not appended to.
  assert.deepEqual(target.events(), trace);
  target.free();
});

const TWO_PROCESS_BPMN = (a, b) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="${a}" isExecutable="true"><bpmn:startEvent id="s1" /></bpmn:process>
  <bpmn:process id="${b}" isExecutable="true"><bpmn:startEvent id="s2" /></bpmn:process>
</bpmn:definitions>`;

test("deployedProcessIds lists a trace's processes in order, de-duplicated", async () => {
  const session = await createBojtosSession({ wasm: wasmBytes });
  const first = session.deploy(TWO_PROCESS_BPMN("b", "a")).processIds;
  session.deploy(ONE_TASK_BPMN);
  session.deploy(TWO_PROCESS_BPMN("b", "a")); // redeploy: no duplicates
  const trace = session.events();
  session.free();
  assert.deepEqual(deployedProcessIds(trace), [...first, "one"]);
  // Restoring into a session that deployed something else yields the trace's ids.
  const other = await runOne();
  other.replayEvents(trace);
  assert.deepEqual(deployedProcessIds(other.events()), [...first, "one"]);
  other.free();
  // Malformed / empty input is tolerated, never throws.
  assert.deepEqual(deployedProcessIds([]), []);
  assert.deepEqual(
    deployedProcessIds([{ seq: 1, now: 0, type: "ProcessDeployed", process: null }]),
    [],
  );
});

test("replayEvents rejects a malformed trace and leaves the session intact", async () => {
  const session = await runOne();
  const before = session.snapshot();
  assert.throws(() =>
    session.replayEvents([
      { seq: 1, now: 0, type: "NotARealEventType" },
    ]),
  );
  // The session is untouched: decode-or-throw, never half-apply.
  assert.deepEqual(session.snapshot(), before);
  session.free();
});
