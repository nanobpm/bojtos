// Why a drain stopped, and the opt-in timer advance.
//
// `handled === 0` on its own conflates a finished process with one waiting on a
// human, a timer, a message, or a job type nobody registered — and each needs a
// different response from the UI above. These tests pin the classification and
// the clock-advancing loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createBojtosSession,
  dispatchWorkers,
  settleReason,
  unhandledJobTypes,
  type Snapshot,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/nanobpmn_engine_bg.wasm"),
);

const TIMER_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="waits" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:intermediateCatchEvent id="wait">
      <bpmn:timerEventDefinition><bpmn:timeDuration>PT5M</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:serviceTask id="after"><bpmn:extensionElements><zeebe:taskDefinition type="after" /></bpmn:extensionElements></bpmn:serviceTask>
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="wait" />
    <bpmn:sequenceFlow id="f2" sourceRef="wait" targetRef="after" />
    <bpmn:sequenceFlow id="f3" sourceRef="after" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;

const USER_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="human" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:userTask id="review"><bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements></bpmn:userTask>
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="review" />
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;

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

async function start(bpmn: string, processId: string) {
  const session = await createBojtosSession({ wasm: wasmBytes });
  session.deploy(bpmn);
  session.createInstance(processId, "{}");
  return session;
}

test("a completed drain reports reason 'completed'", async () => {
  const session = await start(ONE_TASK_BPMN, "one");
  const res = await dispatchWorkers(session, { work: () => ({ done: true }) });
  assert.equal(res.reason, "completed");
  assert.deepEqual(res.unhandled, []);
  assert.equal(res.advancedMs, 0);
  session.free();
});

test("a job type with no handler reports 'unhandledJobs' and names it", async () => {
  const session = await start(ONE_TASK_BPMN, "one");
  // A typo'd job type: the loop goes quiet, and without a reason this is
  // indistinguishable from success.
  const res = await dispatchWorkers(session, { wrok: () => ({}) });
  assert.equal(res.reason, "unhandledJobs");
  assert.deepEqual(res.unhandled, ["work"]);
  assert.equal(res.snapshot.completedInstances, 0);
  session.free();
});

test("parking on a user task reports 'userTasks'", async () => {
  const session = await start(USER_TASK_BPMN, "human");
  const res = await dispatchWorkers(session, {});
  assert.equal(res.reason, "userTasks");
  session.free();
});

test("a pending timer reports 'timers' rather than looking finished", async () => {
  const session = await start(TIMER_BPMN, "waits");
  const res = await dispatchWorkers(session, { after: () => ({ ran: true }) });
  assert.equal(res.reason, "timers");
  assert.equal(res.snapshot.completedInstances, 0);
  assert.equal(res.snapshot.timers.length, 1);
  session.free();
});

test("advanceTimers drives the clock and finishes the process", async () => {
  const session = await start(TIMER_BPMN, "waits");
  const res = await dispatchWorkers(
    session,
    { after: () => ({ ran: true }) },
    { advanceTimers: true },
  );
  assert.equal(res.reason, "completed");
  assert.equal(res.snapshot.completedInstances, 1);
  // PT5M, and the loop jumped exactly that far.
  assert.equal(res.advancedMs, 5 * 60 * 1000);
  session.free();
});

test("advanceTimers maxTotalMs is a budget for the whole drain", async () => {
  const session = await start(TIMER_BPMN, "waits");
  const res = await dispatchWorkers(
    session,
    { after: () => ({ ran: true }) },
    { advanceTimers: { maxTotalMs: 60_000 } },
  );
  // A minute of budget can't reach a five-minute timer — and crucially can't
  // reach it in instalments either. The clock does not move at all, because a
  // partial hop would spend the budget and fire nothing.
  assert.equal(res.reason, "timers");
  assert.equal(res.snapshot.completedInstances, 0);
  assert.equal(res.advancedMs, 0);
  session.free();
});

test("advanceTimers spends its budget when the timer fits", async () => {
  const session = await start(TIMER_BPMN, "waits");
  const res = await dispatchWorkers(
    session,
    { after: () => ({ ran: true }) },
    { advanceTimers: { maxTotalMs: 10 * 60 * 1000 } },
  );
  assert.equal(res.reason, "completed");
  assert.equal(res.advancedMs, 5 * 60 * 1000);
  session.free();
});

// `settleReason` is pure, so the ordering rules can be checked without an engine.
const emptySnapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  now: 0,
  eventCount: 0,
  totalInstances: 1,
  completedInstances: 0,
  instances: [
    {
      key: "1",
      processId: "p",
      state: "Active",
      completed: false,
      activeElements: [],
      variables: {},
    },
  ],
  jobs: [],
  incidents: [],
  timers: [],
  userTasks: [],
  messageSubscriptions: [],
  signalSubscriptions: [],
  elementStats: [],
  takenSequenceFlows: [],
  decisionInstances: [],
  activeElementIds: [],
  incidentElementIds: [],
  ...over,
});

test("settleReason reports the actionable cause first", () => {
  // An incident outranks a wait: the wait will never end until it's resolved.
  assert.equal(
    settleReason(
      emptySnapshot({
        incidents: [
          { key: "i", instanceKey: "1", elementId: "x", kind: "JOB", reason: "boom" },
        ],
        timers: [{ key: "t", instanceKey: "1", elementId: "w", dueAt: 1, dueInMs: 1 }],
      }),
    ),
    "incidents",
  );
  // No live instances at all is idle, not "completed", when none ever ran.
  assert.equal(
    settleReason(emptySnapshot({ instances: [], totalInstances: 0 })),
    "idle",
  );
  assert.equal(
    settleReason(emptySnapshot({ instances: [], totalInstances: 3 })),
    "completed",
  );
});

test("unhandledJobTypes lists only job types without a handler", () => {
  const snap = emptySnapshot({
    jobs: [
      { key: "1", instanceKey: "1", elementId: "a", jobType: "known", state: "Created", retries: 3 },
      { key: "2", instanceKey: "1", elementId: "b", jobType: "typo", state: "Created", retries: 3 },
    ],
  });
  assert.deepEqual(unhandledJobTypes(snap, ["known"]), ["typo"]);
  assert.deepEqual(unhandledJobTypes(snap, ["known", "typo"]), []);
});
