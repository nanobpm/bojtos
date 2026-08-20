// The read-model handle a `ReadModelBojtosSession` exposes via `readModel()`
// drives `@nanobpm/engine-testkit`'s `assertThat*` DSL end-to-end against a real
// deployed+run instance through the session — the point of S4 (nanobpm/bojtos#15).
//
// It proves three things the acceptance calls for:
//  1. the handle structurally satisfies engine-testkit's `EngineReadModel` port —
//     a compile-time assignment (`const port: EngineReadModel = …`), not a shim;
//  2. that same handle powers `assertThatInstance` / `assertThatUserTask` over a
//     real instance advanced through the session's own command surface; and
//  3. no snapshot re-derivation — the handle's `snapshot()` deep-equals the
//     session's `snapshot()`, reading from the same source of truth (each call
//     parses the canonical snapshot afresh, so they are equal, not identical).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  assertThatInstance,
  assertThatUserTask,
  byProcessId,
  type EngineReadModel,
} from "@nanobpm/engine-testkit";
import {
  createBojtosSession,
  dispatchWorkers,
  type ReadModelBojtosSession,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/readmodel/nanobpmn_engine_bg.wasm"),
);

// prepare (service task) → review (user task) → done.
const REVIEW_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="review" isExecutable="true">
    <bpmn:startEvent id="start" />
    <bpmn:serviceTask id="prepare"><bpmn:extensionElements><zeebe:taskDefinition type="prep" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:userTask id="review-task"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>
    <bpmn:endEvent id="done" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="prepare" />
    <bpmn:sequenceFlow id="f2" sourceRef="prepare" targetRef="review-task" />
    <bpmn:sequenceFlow id="f3" sourceRef="review-task" targetRef="done" />
  </bpmn:process>
</bpmn:definitions>`;

async function reviewSessionAtUserTask(): Promise<ReadModelBojtosSession> {
  const session = await createBojtosSession({
    variant: "readmodel",
    wasm: wasmBytes,
  });
  session.deploy(REVIEW_BPMN);
  session.createInstance("review", '{"doc":"contract"}');
  await dispatchWorkers(session, { prep: () => ({ prepared: true }) });
  return session;
}

test("readModel() satisfies EngineReadModel and drives the assertThat* DSL", async () => {
  const session = await reviewSessionAtUserTask();

  // (1) Compile-time assignment: the handle IS an `EngineReadModel`. If the
  // structural shape ever drifted this line would fail `tsc`, not at runtime.
  const port: EngineReadModel = session.readModel();

  // (2) Drive the instance matchers off the handle against the real instance:
  // parked on the user task, seeded variable is visible, still active.
  assertThatInstance(port, byProcessId("review"))
    .isActive()
    .hasActiveElement("review-task")
    .hasCompletedElements("prepare")
    .hasVariable("doc", "contract");

  // (3) Drive the user-task matchers off the same handle: the review task is
  // open (CREATED) — this exercises `openUserTasks` and element-id narrowing.
  await assertThatUserTask(port, { elementId: "review-task" }).isCreated();

  session.free();
});

test("readModel() sees the instance complete after the user task is completed", async () => {
  const session = await reviewSessionAtUserTask();
  const port = session.readModel();

  const userTaskKey = session
    .snapshot()
    .userTasks.find((t) => t.state === "Created")?.key;
  assert.ok(userTaskKey, "expected an open user task to complete");

  session.completeUserTask(userTaskKey, '{"decision":"approved"}');

  // Re-reading through the same `port` handle now reflects the completed run —
  // proving subsequent calls read live engine state rather than a snapshot
  // captured at construction time.
  assertThatInstance(port, byProcessId("review")).hasCompleted();
  await assertThatUserTask(port, { elementId: "review-task" }).isCompleted();

  session.free();
});

test("readModel().snapshot() is the session's snapshot — no re-derivation", async () => {
  const session = await reviewSessionAtUserTask();
  const port = session.readModel();

  // Single source of truth: the port hands back the engine's own parsed snapshot
  // shape, structurally identical to what the session exposes directly.
  assert.deepEqual(port.snapshot(), session.snapshot());

  session.free();
});
