// bpmn-js must stay tree-shakeable out of a trace-only import (nanobpm/bojtos#9).
//
// `<BpmnRuntimeView>` imports bpmn-js (the diagram renderer); `<TraceTimeline>`
// must not, so an app that imports only the timeline never pulls the diagram
// bundle in. The package is `sideEffects: false`, so a bundler drops unused
// re-exports from the barrel — but only if the timeline's own module graph never
// statically reaches bpmn-js. This walks the built local import graph starting at
// `dist/TraceTimeline.js` and asserts nothing on that path imports bpmn-js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

/** Every `import`/`export ... from "..."` specifier in a built module. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  // Bare side-effect imports: `import "x";`
  const re2 = /\bimport\s*["']([^"']+)["']/g;
  while ((m = re2.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

/** Walk the local (relative) module graph from `entry`, collecting every
 *  non-relative (bare) package specifier reached along the way. */
function reachedBarePackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) {
        stack.push(resolve(dirname(file), spec));
      } else {
        bare.add(spec);
      }
    }
  }
  return bare;
}

/** True if any reached bare specifier is bpmn-js or a bpmn-js subpath. */
function reachesBpmnJs(bare: Set<string>): boolean {
  for (const spec of bare) {
    if (spec === "bpmn-js" || spec.startsWith("bpmn-js/")) return true;
  }
  return false;
}

test("a trace-only import graph never reaches bpmn-js", () => {
  const bare = reachedBarePackages(join(dist, "TraceTimeline.js"));
  assert.ok(
    !reachesBpmnJs(bare),
    `TraceTimeline transitively imports bpmn-js (reached: ${[...bare].join(", ")})`,
  );
  // Sanity: it does reach its real deps, so the walk isn't silently empty.
  assert.ok(bare.has("react"), "expected TraceTimeline to import react");
  assert.ok(
    bare.has("@nanobpm/bojtos-kit"),
    "expected TraceTimeline to import the kit",
  );
});

test("the diagram view *does* import bpmn-js (guards the test above)", () => {
  // If BpmnRuntimeView ever stopped importing bpmn-js, the tree-shaking test
  // would pass trivially. Pin that the negative test has real teeth.
  const bare = reachedBarePackages(join(dist, "BpmnRuntimeView.js"));
  assert.ok(reachesBpmnJs(bare));
});
