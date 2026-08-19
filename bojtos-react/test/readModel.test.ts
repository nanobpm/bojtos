// The reactive read-model surface (nanobpm/bojtos#13).
//
// `useBojtos({ variant: "readmodel" })` widens its controls to expose the
// gateway's Camunda-parity REST read channel plus a `readModelVersion`
// reactivity signal, with `useReadModel` as the ready-made selector. As with
// `view.test.ts`, the React lifecycle itself needs a DOM stack this repo doesn't
// carry, so the *decisions* are kept in pure helpers (`resolveVariant`,
// `selectReadModel`) and tested here — the variant default (existing consumers
// stay lean) and the "no live read-model session → null, else pull" guard every
// read method routes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVariant, selectReadModel } from "../dist/runState.js";

test("resolveVariant defaults to lean so existing consumers are unaffected", () => {
  // No variant / undefined means lean — the whole point of the default is that a
  // hook that never mentions `variant` never downloads the heavier read-model
  // binary.
  assert.equal(resolveVariant(undefined), "lean");
  assert.equal(resolveVariant("lean"), "lean");
  // An explicit readmodel is honoured verbatim.
  assert.equal(resolveVariant("readmodel"), "readmodel");
});

test("selectReadModel returns null when there is no live read-model session", () => {
  // A lean-variant hook (or one still loading) has no read channel: the pull
  // must be a quiet null, never a throw on a missing engine. The selector is not
  // even invoked.
  let called = false;
  const out = selectReadModel(null, () => {
    called = true;
    return "unreachable";
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("selectReadModel runs the selector against a live channel and returns its value", () => {
  // With a channel present, the selector runs and its result passes through —
  // including a falsy-but-not-null result (e.g. getFormByKey returning null for
  // an absent key is a legitimate answer, distinct from "no session").
  const channel = {
    searchUserTasks: (filterJson?: string) => ({ filterJson: filterJson ?? "" }),
    getFormByKey: (_formKey: string) => null,
  };

  assert.deepEqual(
    selectReadModel(channel, (rm) => rm.searchUserTasks('{"state":"CREATED"}')),
    { filterJson: '{"state":"CREATED"}' },
  );

  // A live session whose query legitimately has no result still returns that
  // result (null), not a "no session" null — same value here, but the selector
  // *was* consulted.
  let consulted = false;
  const form = selectReadModel(channel, (rm) => {
    consulted = true;
    return rm.getFormByKey("999");
  });
  assert.equal(form, null);
  assert.equal(consulted, true);
});
