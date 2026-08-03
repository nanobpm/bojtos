# Bojtos

**Bojtos** is the in-browser BPMN demo framework for [Nano BPM](https://nanobpm.io).
It runs the real Nano workflow engine — compiled to WebAssembly — entirely in the
browser, so a documentation page or a landing site can deploy a BPMN process,
start instances, complete and fail jobs, advance the clock, and render a live
token/incident diagram, with no backend.

This monorepo contains the two published packages:

| Package | What it is |
|---|---|
| [`@nanobpm/bojtos-kit`](bojtos-kit) | Framework-agnostic core. A single scenario runner over [`@nanobpm/engine-wasm`](https://www.npmjs.com/package/@nanobpm/engine-wasm) (deploy, start instances, complete/fail jobs, advance the clock, read snapshots and the event log), plus a worker registry + dispatch loop and the engine's snapshot/event contract types. |
| [`@nanobpm/bojtos-react`](bojtos-react) | React binding: the `useBojtos` hook (owns the engine session + reactive snapshot/event state) and `<BpmnRuntimeView>`, the live token/incident diagram. |

The BPMN engine itself ships as a separate, versioned npm package,
[`@nanobpm/engine-wasm`](https://www.npmjs.com/package/@nanobpm/engine-wasm),
published from the Nano BPM engine repository. Bojtos consumes it as an ordinary
npm dependency, so this repo needs only Node — no Rust or `wasm-pack` toolchain.

## Quick start (kit)

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

See each package's README for the full API.

## Develop

This is an npm-workspaces monorepo (Node >= 22).

```bash
npm install        # installs both packages + the published engine-wasm
npm run typecheck  # tsc --noEmit for both packages
npm run build      # tsc build (emits dist/ for both)
npm test           # build + run bojtos-kit's engine tests
```

`bojtos-react` links `bojtos-kit` as a workspace, so a change to the kit is
picked up without a republish.

## Design

Bojtos is a thin, framework-agnostic runner over a **single** engine session:
one scenario runner that the whole framework (and every consumer) drives, so
there is no second, drift-prone engine harness.

- **`@nanobpm/engine-wasm`** — the real Nano engine core, compiled with
  `wasm-pack --target web`, as a versioned, publishable npm package. It is the
  linchpin: nothing in the browser is possible until the engine is installable.
  It is built and released from the Nano BPM engine repo, not here.
- **`@nanobpm/bojtos-kit`** — engine lifecycle, the worker registry + dispatch
  loop, the trace/event model, and the serializable scenario type. Depends on
  `@nanobpm/engine-wasm` via a semver range.
- **`@nanobpm/bojtos-react`** — the reactive React surface (`useBojtos`) and the
  live diagram (`<BpmnRuntimeView>`), built on the kit.

The packages ship prebuilt `dist/` in their npm tarballs; consumers import the
compiled JS + `.d.ts` without re-bundling.

## Release

Publishing is driven by a git tag and npm OIDC **trusted publishing** — there is
no `NPM_TOKEN`. To cut a release:

1. Bump the version in **both** `bojtos-kit/package.json` and
   `bojtos-react/package.json` to the same value (they release together).
2. Commit, then push a tag `vX.Y.Z` matching that version.
3. `.github/workflows/release.yml` builds, tests, verifies the tag matches the
   package versions, and publishes `bojtos-kit` then `bojtos-react` in
   dependency order (with npm provenance, since this repo is public).

`scripts/release.mjs` also drives a local publish (`node scripts/release.mjs`,
`--dry-run` to preview). See [docs/releasing.md](docs/releasing.md) for the
one-time Trusted Publisher setup on npmjs.com.

## License

[Apache-2.0](LICENSE)
