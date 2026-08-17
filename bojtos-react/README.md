# @nanobpm/bojtos-react

React binding for the **Bojtos** in-browser BPMN demo framework
([ADR 0043](../README.md#design)), built on
[`@nanobpm/bojtos-kit`](../bojtos-kit).

- **`useBojtos({ bpmn })`** — owns the engine session and the reactive
  `snapshot` / `events` / `processIds` state, and exposes the engine commands
  (`createInstance`, `completeJob`, `failJob`, `advanceTime`, `reset`).
- **`<BpmnRuntimeView xml activeIds incidentIds />`** — the live diagram: it
  imports the XML once and updates token (`nano-active`) / incident
  (`nano-incident`) markers in place, so zoom/scroll survive stepping.
- **`<TraceTimeline rows />`** — the shared activity log: it renders the
  framework-agnostic trace model from [`@nanobpm/bojtos-kit`](../bojtos-kit) as a
  turn-by-turn story (consecutive same-`turn` rows fold into one card; rows with
  no `turn` render as plain lines). Feed it a kit adapter —
  `foldEngineEvents(run.events)` for a plain engine run, or
  `traceEntriesToRows(entries)` for handler-emitted agent/tool/turn entries. It
  imports **only** the kit and React, so a trace-only import tree-shakes `bpmn-js`
  out (the package is `sideEffects: false`); a test walks the built module graph
  to pin that.

## Install

```bash
npm install @nanobpm/bojtos-react react react-dom bpmn-js
```

`@nanobpm/bojtos-kit` and `@nanobpm/engine-wasm` (the wasm engine) are pulled in
transitively — you only add the `react` / `bpmn-js` peers yourself. This is all
you need to build your own Bojtos demo outside this repo; see the usage snippet
below.

## Usage

```tsx
import { useBojtos, BpmnRuntimeView } from "@nanobpm/bojtos-react";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

function Demo({ bpmn }: { bpmn: string }) {
  const run = useBojtos({ bpmn });
  const snap = run.snapshot;
  return (
    <BpmnRuntimeView
      xml={bpmn}
      activeIds={snap?.activeElementIds ?? []}
      incidentIds={snap?.incidentElementIds ?? []}
    />
  );
}
```

## Trace timeline

```tsx
import { useBojtos, TraceTimeline, foldEngineEvents } from "@nanobpm/bojtos-react";

function RunLog({ bpmn }: { bpmn: string }) {
  const run = useBojtos({ bpmn });
  // Engine-event fold — the non-agentic / test-view case.
  return <TraceTimeline rows={foldEngineEvents(run.events)} />;
}
```

For an agentic run, emit `TraceEntry` lines from your handlers (with the additive
`turn` / `elementId` / `args` / `result` fields) and pass
`traceEntriesToRows(entries)` instead — same component, turn-grouped card view.
`TraceTimeline` keeps the class names (`timeline`, `timeline-turn`,
`log-line log-<kind>`, …) the demo stylesheet already targets, so your CSS applies
unchanged. It never imports `bpmn-js`, so importing it alone won't pull the
diagram bundle in.

## Peer requirements

`react` and `bpmn-js` are peer dependencies (the consumer already has them). The
consumer must import bpmn-js's diagram CSS once and provide the `.nano-active` /
`.nano-incident` marker styles.

## Build

`dist/` (the tsc-emitted JS + `.d.ts`, with JSX already compiled to
`react/jsx-runtime` so consumers never re-transform node_modules) is what ships,
built by `prepack` on publish. It is **not** committed — `.gitignore` covers it —
so build before pointing a `file:` consumer at this workspace. Regenerate with
`npm run build`.
