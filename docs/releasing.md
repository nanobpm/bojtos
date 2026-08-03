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

- `bojtos-react` links `bojtos-kit` as an npm workspace, and pins it with a
  `^<version>` range that is published verbatim. If a contributor instead uses a
  `file:` link, **`scripts/release.mjs`** rewrites it to `^<version>` at publish
  time and restores it afterwards.
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

After that, tagged releases publish automatically with no secret. (If you ever
create a brand-new `@nanobpm/*` package, its very first publish must be done
locally by a maintainer with publish rights — a Trusted Publisher can only be
configured on a package that already exists.)

## Cutting a release

1. Bump the version in **both** packages to the same value:
   - `bojtos-kit/package.json`
   - `bojtos-react/package.json`

   (Keep `bojtos-react`'s `@nanobpm/bojtos-kit` dependency range covering the new
   version.)
2. Commit, open a PR, merge to `main`.
3. Tag from `main` and push:
   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```
4. The `release` workflow builds/tests both packages, verifies the tag matches
   both versions, and publishes them in dependency order via OIDC (with
   provenance).
5. Verify on npmjs.com:
   - <https://www.npmjs.com/package/@nanobpm/bojtos-kit>
   - <https://www.npmjs.com/package/@nanobpm/bojtos-react>

## Manual dry-run (local, no publish)

```bash
npm run build
node scripts/release.mjs --dry-run
```

This runs `npm publish --dry-run` for each package and prints the tarball
contents without publishing.
