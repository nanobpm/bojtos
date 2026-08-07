// Agent tool activation: the variables an agent passes per-tool.
//
// `AgentResult.activateElements[].variables` are described by nano-bpm's
// `spec/jobs.yaml` as "variables scoped to that element", and by ADR 0023 as
// "applied through the tool's ioMapping". Engine 0.3.0 dropped them entirely —
// they reached neither the tool's job nor the instance (Magikcraft/nano-bpm#605)
// — which forced consumers to merge tool arguments into the instance root
// instead, putting every tool's arguments in one flat namespace.
//
// 0.3.1 delivers them. These tests pin that, because the workaround is worse
// than the bug and would quietly come back if the behaviour regressed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createBojtosSession, dispatchWorkers } from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/nanobpmn_engine_bg.wasm"),
);

// An agent container with two tools: one with no ioMapping, one whose input
// mapping copies the activation variable through a plain FEEL expression. The
// two cover both readings of the contract.
const AGENT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="agent-activation" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="agent" />
    <bpmn:adHocSubProcess id="agent">
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="io.camunda.agenticai:aiagent-job-worker:1" />
      </bpmn:extensionElements>
      <bpmn:serviceTask id="plain">
        <bpmn:extensionElements><zeebe:taskDefinition type="tool-plain" /></bpmn:extensionElements>
      </bpmn:serviceTask>
      <bpmn:serviceTask id="mapped">
        <bpmn:extensionElements>
          <zeebe:taskDefinition type="tool-mapped" />
          <zeebe:ioMapping><zeebe:input source="=toolArg" target="copied" /></zeebe:ioMapping>
        </bpmn:extensionElements>
      </bpmn:serviceTask>
    </bpmn:adHocSubProcess>
    <bpmn:sequenceFlow id="f2" sourceRef="agent" targetRef="e" />
    <bpmn:endEvent id="e" />
  </bpmn:process>
</bpmn:definitions>`;

test("activation variables reach the activated tool, scoped to it", async () => {
  const session = await createBojtosSession({ wasm: wasmBytes });
  session.deploy(AGENT_BPMN);
  session.createInstance("agent-activation", '{"seeded":"from-start"}');

  let turn = 0;
  const seen: Record<string, Record<string, unknown>> = {};
  const result = await dispatchWorkers(
    session,
    {
      "tool-plain": (job) => {
        seen.plain = job.variables;
        return {};
      },
      "tool-mapped": (job) => {
        seen.mapped = job.variables;
        return {};
      },
    },
    {
      agents: {
        "io.camunda.agenticai:aiagent-job-worker:1": () => {
          turn += 1;
          if (turn === 1)
            return {
              activateElements: [
                { elementId: "plain", variables: { toolArg: "for-plain" } },
                { elementId: "mapped", variables: { toolArg: "for-mapped" } },
              ],
            };
          return { completionConditionFulfilled: true };
        },
      },
    },
  );

  // Reading 1 (spec/jobs.yaml): visible on the activated element's job.
  assert.equal(seen.plain?.toolArg, "for-plain");
  // Reading 2 (ADR 0023): also applied through that tool's ioMapping.
  assert.equal(seen.mapped?.copied, "for-mapped");
  // Each tool sees its own value — this is the property that makes a flat
  // instance-root namespace unnecessary, so two tools can share an argument
  // name without clobbering each other.
  assert.equal(seen.mapped?.toolArg, "for-mapped");
  // The seeded instance variable is still in scope for both.
  assert.equal(seen.plain?.seeded, "from-start");
  // And activation variables stay scoped: they do not leak to the root.
  assert.equal(result.snapshot.instances[0]?.variables.toolArg, undefined);

  session.free();
});
