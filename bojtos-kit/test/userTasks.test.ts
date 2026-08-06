// User-task lifecycle against the real wasm engine.
//
// A `userTask` produces no job, so `dispatchWorkers` cannot advance one: the
// session's user-task commands are the only way a model with a human step
// reaches its end event. These tests pin that contract, because a consumer that
// cannot reach the command has an unfinishable process (nanobpm/bojtos#1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  type BojtosSession,
  createBojtosSession,
  dispatchWorkers,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/nanobpmn_engine_bg.wasm"),
);

// prepare (service task) → review (user task) → done. The service task proves
// the dispatch loop drains up to the human step and then stops.
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

/** Drain to the user task and return the session plus that task's key. */
async function sessionAtUserTask(): Promise<{
  session: BojtosSession;
  userTaskKey: string;
}> {
  const session = await createBojtosSession({ wasm: wasmBytes });
  session.deploy(REVIEW_BPMN);
  session.createInstance("review", '{"doc":"contract"}');
  const { snapshot } = await dispatchWorkers(session, {
    prep: () => ({ prepared: true }),
  });
  const task = snapshot.userTasks.find((t) => t.state === "Created");
  assert.ok(task, "expected the instance to park on the user task");
  return { session, userTaskKey: task.key };
}

test("the dispatch loop drains to a user task and stops there", async () => {
  const { session, userTaskKey } = await sessionAtUserTask();
  const snap = session.snapshot();

  assert.equal(snap.completedInstances, 0);
  assert.deepEqual(snap.activeElementIds, ["review-task"]);
  // No job is emitted for a user task, so workers alone can never finish this.
  assert.equal(snap.jobs.length, 0);
  assert.ok(userTaskKey);
  session.free();
});

test("completeUserTask finishes the instance and merges its variables", async () => {
  const { session, userTaskKey } = await sessionAtUserTask();

  const snap = session.completeUserTask(
    userTaskKey,
    '{"decision":"approved","comment":"looks fine"}',
  );

  assert.equal(snap.completedInstances, 1);
  assert.equal(
    snap.userTasks.find((t) => t.key === userTaskKey)?.state,
    "Completed",
  );
  session.free();
});

test("assign, update and unassign a waiting user task", async () => {
  const { session, userTaskKey } = await sessionAtUserTask();
  const of = (s: ReturnType<BojtosSession["snapshot"]>) =>
    s.userTasks.find((t) => t.key === userTaskKey)!;

  assert.equal(of(session.snapshot()).assignee, undefined);

  assert.equal(
    of(session.assignUserTask(userTaskKey, "emily", false)).assignee,
    "emily",
  );

  // Without allowOverride, re-assigning an assigned task is rejected.
  assert.throws(() => session.assignUserTask(userTaskKey, "sam", false));
  assert.equal(
    of(session.assignUserTask(userTaskKey, "sam", true)).assignee,
    "sam",
  );

  const updated = of(
    session.updateUserTask(
      userTaskKey,
      '{"candidateGroups":["reviewers"],"priority":80}',
    ),
  );
  assert.deepEqual(updated.candidateGroups, ["reviewers"]);
  assert.equal(updated.priority, 80);

  assert.equal(of(session.unassignUserTask(userTaskKey)).assignee, undefined);

  // Still completable after all that.
  assert.equal(session.completeUserTask(userTaskKey, "{}").completedInstances, 1);
  session.free();
});
