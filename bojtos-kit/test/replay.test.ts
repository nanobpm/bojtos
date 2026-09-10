// `replayEvents` is the inverse of `events()`: a trace serialised out of one
// session must rebuild an identical simulation when replayed into another. These
// tests pin that round-trip and the "decode-or-throw, never half-apply" contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createBojtosSession, dispatchWorkers } from "../dist/index.js";

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
  const expectedCount = source.snapshot().completedInstances;
  source.free();

  // A session with its own unrelated run: replaying must replace it wholesale,
  // not merge into it.
  const target = await runOne();
  assert.equal(target.snapshot().completedInstances, 1);
  const restored = target.replayEvents(trace);
  assert.equal(restored.completedInstances, expectedCount);
  assert.equal(restored.eventCount, trace.length);
  target.free();
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
