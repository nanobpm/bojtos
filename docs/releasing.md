# Releasing the Bojtos npm packages

Publishes the two packages of the Bojtos in-browser BPMN demo framework
(ADR 0043) to npm, in dependency order:

```
@nanobpm/bojtos-kit  →  @nanobpm/bojtos-react
```

The BPMN engine, [`@nanobpm/engine-wasm`](https://www.npmjs.com/package/@nanobpm/engine-wasm),
is **not** released from this repo — it is published separately from the Nano
BPM engine repository and consumed here as an ordinary npm dependency.

Once published, anyone can build their own Bojtos demo (see the quickstart in
[`bojtos-react/README.md`](../bojtos-react/README.md)).

## How it works

- Releases are cut by **semantic-release** (`.releaserc.json`) on every push to
  `main` (`.github/workflows/release.yml`). It reads the conventional commits
  since the last `v*` tag, decides whether a release is due and computes the
  next version. Both packages always release together, at the same version.
- **The versions in the repo's `package.json` files are placeholders.** They
  are never bumped by hand or committed back. At release time
  **`scripts/set-version.mjs`** writes the computed version into every manifest
  and rewrites the internal `@nanobpm/bojtos-*` dependency ranges to
  `^<version>`. So the published `bojtos-react` always depends on the matching
  `bojtos-kit`, whatever range the repo's manifest shows. If a contributor uses
  a `file:` link instead, **`scripts/release.mjs`** rewrites it to `^<version>`
  at publish time and restores it afterwards.
- External dependencies (notably `@nanobpm/engine-wasm`) are **not** rewritten:
  their ranges publish verbatim. On a `0.x` version a caret range stops at the
  next minor (`^0.9.1` is `>=0.9.1 <0.10.0`), so adopting a new engine-wasm
  minor needs an explicit `fix(deps)` bump here.
- Authentication is **npm OIDC trusted publishing** — there is no `NPM_TOKEN`.
  CI mints a short-lived publish token from GitHub OIDC; each package must be
  bound to this repo + workflow on npmjs.com (one-time, below).
- Provenance is **enabled** (`NPM_CONFIG_PROVENANCE=true` in the workflow) —
  this repository is public, so npm can attach a provenance statement.

## One-time setup (per package)

`@nanobpm/bojtos-kit` and `@nanobpm/bojtos-react` already exist on npm (they were
first published from the Nano BPM monorepo). To let this repo publish them, point
each package's Trusted Publisher at this repo:

On npmjs.com, for **each** of `@nanobpm/bojtos-kit` and `@nanobpm/bojtos-react`:
**Settings → Trusted Publisher → GitHub Actions**:

| Field               | Value          |
|---------------------|----------------|
| Organization / user | `nanobpm`      |
| Repository          | `bojtos`       |
| Workflow filename   | `release.yml`  |
| Environment         | *(leave blank)*|

After that, releases publish automatically with no secret. (If you ever
create a brand-new `@nanobpm/*` package, its very first publish must be done
locally by a maintainer with publish rights — a Trusted Publisher can only be
configured on a package that already exists.)

## Cutting a release

There is no manual step: **merging a PR to `main` is the release.** Do not bump
versions or push tags by hand.

1. Use conventional-commit messages for whatever lands on `main`. With a squash
   merge that is the PR title, or the single commit's message for a one-commit
   PR; with a merge or rebase it is every commit. semantic-release reads them:

   | Commit type                              | Release                                  |
   |------------------------------------------|------------------------------------------|
   | `fix:` / `perf:`                         | patch (`0.11.0` → `0.11.1`)              |
   | `feat:`                                  | minor (`0.11.0` → `0.12.0`)              |
   | `BREAKING CHANGE:` footer                | major                                    |
   | `docs:` / `chore:` / `test:` / `ci:` / … | no release                               |

   > **Note:** The current `.releaserc.json` uses commit-analyzer's default
   > Angular preset, whose parser does **not** recognize the `type!:` shorthand
   > (e.g. `feat!: remove an API`) as a breaking change. Always use a
   > `BREAKING CHANGE:` footer for major releases.

2. Merge to `main`. The `release` workflow then:
   1. runs semantic-release, which computes the next version;
   2. stamps it into both manifests and the internal dependency pin
      (`scripts/set-version.mjs`);
   3. pushes the `v<version>` tag;
   4. publishes `bojtos-kit` then `bojtos-react` via OIDC with provenance
      (`scripts/release.mjs`, idempotent, so a re-run is safe);
   5. creates a GitHub Release with generated notes.

   > **Note:** semantic-release pushes the version tag (step 3) **before**
   > invoking `publishCmd` (step 4). If the npm publish fails, the tag already
   > exists, so re-running the workflow at the same commit finds no unreleased
   > commits and skips publishing. To recover, retry the publisher directly with
   > the failed version's manifests and build artifacts:
   >
   > ```bash
   > git checkout v<version>
   > npm ci && npm run build
   > node scripts/release.mjs
   > ```
   >
   > The publish script is idempotent, so this completes the release without
   > duplicating already-published packages.
3. Verify on npmjs.com:
   - <https://www.npmjs.com/package/@nanobpm/bojtos-kit>
   - <https://www.npmjs.com/package/@nanobpm/bojtos-react>

## Manual dry-run (local, no publish)

```bash
npm run build
node scripts/release.mjs --dry-run
```

This runs `npm publish --dry-run` for each package and prints the tarball
contents without publishing.
