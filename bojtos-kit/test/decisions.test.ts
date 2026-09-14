// Tests for the standalone DMN surface (engine-wasm 0.9.1: `deployDecision` /
// `evaluateDecision`), run against the built `dist` with the real wasm engine.
// Node can't resolve the engine's `import.meta.url` wasm fetch, so we pass the
// binary bytes explicitly via the `wasm` source option.
//
// Run: `npm test` (builds first). Requires Node >= 22 for TS type-stripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { type BojtosSession, createBojtosSession } from "../dist/index.js";

const require = createRequire(import.meta.url);
const wasmBytes = await readFile(
  require.resolve("@nanobpm/engine-wasm/lean/nanobpmn_engine_bg.wasm"),
);

// A two-decision DRG: `jedi_or_sith` maps a lightsaber colour to an allegiance,
// and `force_user` (which requires it) maps allegiance + height to a character.
const FORCE_USER_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="force_users" name="force_users" namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="jedi_or_sith" name="Jedi or Sith">
    <decisionTable id="DecisionTable_14n3bxx">
      <input id="Input_1" label="Lightsaber color">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text>lightsaberColor</text>
        </inputExpression>
      </input>
      <output id="Output_1" label="Jedi or Sith" name="jedi_or_sith" typeRef="string">
        <outputValues id="UnaryTests_0hj346a">
          <text>"Jedi","Sith"</text>
        </outputValues>
      </output>
      <rule id="r1"><inputEntry id="ie1"><text>"blue"</text></inputEntry><outputEntry id="oe1"><text>"Jedi"</text></outputEntry></rule>
      <rule id="r2"><inputEntry id="ie2"><text>"green"</text></inputEntry><outputEntry id="oe2"><text>"Jedi"</text></outputEntry></rule>
      <rule id="r3"><inputEntry id="ie3"><text>"red"</text></inputEntry><outputEntry id="oe3"><text>"Sith"</text></outputEntry></rule>
    </decisionTable>
  </decision>
  <decision id="force_user" name="Which force user?">
    <informationRequirement id="ir1">
      <requiredDecision href="#jedi_or_sith" />
    </informationRequirement>
    <decisionTable id="DecisionTable_07g94t1" hitPolicy="FIRST">
      <input id="InputClause_0qnqj25" label="Jedi or Sith">
        <inputExpression id="LiteralExpression_00lcyt5" typeRef="string"><text>jedi_or_sith</text></inputExpression>
      </input>
      <input id="InputClause_0k64hys" label="Body height">
        <inputExpression id="LiteralExpression_0ib6fnk" typeRef="number"><text>height</text></inputExpression>
      </input>
      <output id="OutputClause_0hhe1yo" label="Force user" name="force_user" typeRef="string" />
      <rule id="fr1"><inputEntry id="fie1"><text>"Jedi"</text></inputEntry><inputEntry id="fie1b"><text>&gt; 190</text></inputEntry><outputEntry id="foe1"><text>"Mace Windu"</text></outputEntry></rule>
      <rule id="fr2"><inputEntry id="fie2"><text>"Jedi"</text></inputEntry><inputEntry id="fie2b"><text>&gt; 180</text></inputEntry><outputEntry id="foe2"><text>"Obi-Wan Kenobi"</text></outputEntry></rule>
      <rule id="fr6"><inputEntry id="fie6"><text></text></inputEntry><inputEntry id="fie6b"><text></text></inputEntry><outputEntry id="foe6"><text>"unknown"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

async function newDecisionSession(): Promise<BojtosSession> {
  return createBojtosSession({ wasm: wasmBytes });
}

test("deployDecision registers every decision in the DRG with typed metadata", async () => {
  const session = await newDecisionSession();
  const result = session.deployDecision(FORCE_USER_DMN);

  assert.equal(result.decisionRequirementsId, "force_users");
  assert.equal(typeof result.decisionRequirementsKey, "string");
  assert.equal(result.version, 1);

  const ids = result.decisions.map((d) => d.decisionId).sort();
  assert.deepEqual(ids, ["force_user", "jedi_or_sith"]);

  const jos = result.decisions.find((d) => d.decisionId === "jedi_or_sith");
  assert.ok(jos, "jedi_or_sith is registered");
  assert.equal(jos.decisionName, "Jedi or Sith");
  assert.equal(typeof jos.decisionKey, "string");
  assert.equal(jos.version, 1);
});

test("evaluateDecision runs a deployed decision and returns its output", async () => {
  const session = await newDecisionSession();
  session.deployDecision(FORCE_USER_DMN);

  const jedi = session.evaluateDecision(
    "jedi_or_sith",
    JSON.stringify({ lightsaberColor: "blue" }),
  );
  assert.equal(jedi.decisionId, "jedi_or_sith");
  assert.equal(typeof jedi.decisionKey, "string");
  assert.equal(jedi.output, "Jedi");

  const sith = session.evaluateDecision(
    "jedi_or_sith",
    JSON.stringify({ lightsaberColor: "red" }),
  );
  assert.equal(sith.output, "Sith");

  // The dependent decision pulls its required decision transitively.
  const character = session.evaluateDecision(
    "force_user",
    JSON.stringify({ lightsaberColor: "blue", height: 200 }),
  );
  assert.equal(character.decisionId, "force_user");
  assert.equal(character.output, "Mace Windu");
});

test("evaluateDecision defaults empty variables to an empty object", async () => {
  const session = await newDecisionSession();
  session.deployDecision(FORCE_USER_DMN);

  // No matching rule for an absent colour falls through to the catch-all only in
  // `force_user`; `jedi_or_sith` has no catch-all, so an empty input yields null.
  const result = session.evaluateDecision("jedi_or_sith", "");
  assert.equal(result.decisionId, "jedi_or_sith");
  assert.equal(result.output, null);
});

test("evaluateDecision throws for an unknown decision id", async () => {
  const session = await newDecisionSession();
  session.deployDecision(FORCE_USER_DMN);

  assert.throws(() => session.evaluateDecision("nope", "{}"));
});

test("deploy routes a DMN resource by content (engine-side routing)", async () => {
  const session = await newDecisionSession();
  // `deploy` is typed for BPMN, but the engine routes DMN by content; the call
  // succeeds and the decision is then evaluable.
  session.deploy(FORCE_USER_DMN);
  const result = session.evaluateDecision(
    "jedi_or_sith",
    JSON.stringify({ lightsaberColor: "green" }),
  );
  assert.equal(result.output, "Jedi");
});
