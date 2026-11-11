// The zoom controls on BpmnRuntimeView: the step and clamp are a pure decision
// (src/zoom.ts) so they can be tested without a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ZOOM, MIN_ZOOM, nextZoom } from "../dist/zoom.js";

test("zoom in and out are inverse steps", () => {
  const z = nextZoom(1, "in");
  assert.ok(z > 1);
  assert.ok(Math.abs(nextZoom(z, "out") - 1) < 1e-9);
});

test("zoom is clamped to [MIN_ZOOM, MAX_ZOOM]", () => {
  assert.equal(nextZoom(MAX_ZOOM, "in"), MAX_ZOOM);
  assert.equal(nextZoom(MIN_ZOOM, "out"), MIN_ZOOM);
  assert.equal(nextZoom(MAX_ZOOM * 0.99, "in"), MAX_ZOOM);
});

test("a non-finite current zoom (no diagram yet) falls back to 1", () => {
  assert.equal(nextZoom(Number.NaN, "in"), nextZoom(1, "in"));
});
