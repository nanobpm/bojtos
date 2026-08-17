# @nanobpm/bojtos-kit

Framework-agnostic core of the **Bojtos** in-browser BPMN demo framework
([ADR 0043](../README.md#design)).

It wraps [`@nanobpm/engine-wasm`](https://www.npmjs.com/package/@nanobpm/engine-wasm) as a single scenario runner —
the one runner the whole framework (and the console test-run panel) drives, so
there is no second, drift-prone engine harness — and re-exports the engine's
snapshot/event contract types.

```ts
import { createBojtosSession } from "@nanobpm/bojtos-kit";

const session = await createBojtosSession(); // loads the wasm engine once
const { processIds } = session.deploy(bpmnXml);
let snapshot = session.createInstance(processIds[0], "{}");
// a service task is now waiting as a job:
snapshot = session.completeJob(snapshot.jobs[0].key, JSON.stringify({ ok: true }));
const trace = session.events(); // WasmEvent[] for a step/trace view
session.free();
```

Every command returns the post-run `Snapshot`: `activeElementIds` /
`incidentElementIds` drive the token/incident highlight, and
`instances[].variables` is the live payload that mutates as workers complete.

For React, use [`@nanobpm/bojtos-react`](../bojtos-react), which owns the session
lifecycle and reactive state on top of this kit.

## Trace model

The kit also holds the framework-agnostic **trace model** the shared
`<TraceTimeline>` (in `@nanobpm/bojtos-react`) renders — one normalized
row/turn-group model plus the two adapters that map a source into it, so the two
formerly forked timelines share one fold instead of drifting apart:

- **`foldEngineEvents(events)`** — the engine-event fold: a `WasmEvent[]` (from
  `session.events()` / `useBojtos().events`) → normalized `TraceRow[]`, keeping the
  run's milestones and dropping low-signal lifecycle noise. The non-agentic /
  test-view case.
- **`traceEntriesToRows(entries)`** — the handler-emitted adapter: agent/tool/turn
  `TraceEntry` lines (with the additive `turn` grouping field) → `TraceRow[]`. The
  agentic web-demo case.
- **`buildTraceItems(rows)`** — folds consecutive same-`turn` rows into
  `TraceTurnGroup`s; rows with no `turn` stay flat. `isTraceTurnGroup` narrows an
  item. This is the grouping the view consumes.

It is pure and React-free (no React import in the kit), keeping the presentational
layer thin.

## Build

`dist/` (the tsc-emitted JS + `.d.ts`) is what ships, built by `prepack` on
publish and by `npm test` locally. It is **not** committed — `.gitignore` covers
it — so build before pointing a `file:` consumer at this workspace. Regenerate
with `npm run build`.
