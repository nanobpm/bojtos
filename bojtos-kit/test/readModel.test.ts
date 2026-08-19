// Read-model engine variant against the real wasm: `createBojtosSession({
// variant: "readmodel" })` exposes the gateway's Camunda-parity REST read
// channel (searchUserTasks / searchProcessInstances / searchVariables /
// getFormByKey / getResourceByKey) on top of the lean command surface, with the
// results typed from `@nanobpm/engine-wasm/readmodel-types`. These pin that the
// variant loads, the read methods project engine state, and the lean command
// surface still works on the same session (nanobpm/bojtos#11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createBojtosSession,
  dispatchWorkers,
  type ProcessInstanceSearchQueryResult,
  type ReadModelBojtosSession,
  type UserTaskSearchQueryResult,
  type VariableSearchQueryResult,
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

async function readModelSessionAtUserTask(): Promise<ReadModelBojtosSession> {
  const session = await createBojtosSession({
    variant: "readmodel",
    wasm: wasmBytes,
  });
  session.deploy(REVIEW_BPMN);
  session.createInstance("review", '{"doc":"contract"}');
  await dispatchWorkers(session, { prep: () => ({ prepared: true }) });
  return session;
}

test("the read-model variant exposes the read channel over the lean surface", async () => {
  const session = await readModelSessionAtUserTask();

  // Same lean command surface is still present on a read-model session.
  assert.equal(session.snapshot().activeElementIds[0], "review-task");

  // searchUserTasks projects the parked task, typed as UserTaskSearchQueryResult.
  const tasks: UserTaskSearchQueryResult = session.searchUserTasks(
    JSON.stringify({ state: "CREATED" }),
  );
  assert.ok(Array.isArray(tasks.items), "items is an array");
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0]?.elementId, "review-task");

  // searchProcessInstances sees the running instance.
  const insts: ProcessInstanceSearchQueryResult =
    session.searchProcessInstances("{}");
  assert.equal(insts.items.length, 1);
  assert.equal(insts.items[0]?.processDefinitionId, "review");

  // searchVariables sees the seeded variable.
  const vars: VariableSearchQueryResult = session.searchVariables("{}");
  assert.ok(
    vars.items.some((v) => v.name === "doc"),
    "expected the seeded `doc` variable in the read model",
  );

  session.free();
});

test("getFormByKey / getResourceByKey return null when absent", async () => {
  const session = await readModelSessionAtUserTask();

  assert.equal(session.getFormByKey("999"), null);
  assert.equal(session.getResourceByKey("999"), null);

  session.free();
});
