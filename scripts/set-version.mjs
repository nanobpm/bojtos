#!/usr/bin/env node
// Set the monorepo's release version everywhere, in lockstep.
//
// semantic-release derives the next version from the conventional-commit
// history and hands it to this script in the `prepare` step (see .releaserc.json);
// `scripts/release.mjs` then publishes whatever version it finds in the package
// manifests. This script is the single writer that keeps every manifest — and
// the internal `@nanobpm/*` cross-dependency pins — agreed on that one version,
// so the two packages always release as a matched pair (the same lockstep
// invariant `release.mjs` asserts before publishing).
//
// Usage:
//   node scripts/set-version.mjs <version>
//
// It is intentionally NOT git-aware: it only rewrites files. semantic-release
// owns the tag/release; nothing is committed back to `main`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Keep this list in step with scripts/release.mjs — the packages that carry the
// shared release version. The root manifest is bumped too, only so every
// manifest agrees on the version within the release run (it is `private`, never
// published, and — since nothing is committed back to `main` — the bump is
// ephemeral: the repo tree and the release tag keep the pre-release version).
const MANIFESTS = ["package.json", "bojtos-kit/package.json", "bojtos-react/package.json"];

// Internal packages whose cross-dependency pins must track the release version,
// so a published `@nanobpm/bojtos-react@x` always depends on the matching
// `@nanobpm/bojtos-kit@^x` that was published in the same run.
const INTERNAL = new Set(["@nanobpm/bojtos-kit", "@nanobpm/bojtos-react"]);

const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"];

function main() {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/.test(version)) {
    console.error(`Usage: node scripts/set-version.mjs <semver>\nGot: ${version ?? "(nothing)"}`);
    process.exit(2);
  }

  for (const rel of MANIFESTS) {
    const file = join(root, rel);
    const text = readFileSync(file, "utf8");
    const json = JSON.parse(text);
    json.version = version;

    // Repoint any internal cross-dependency pin at the new version. Preserve a
    // `file:` link (used for local workspace linking) — release.mjs rewrites
    // those to `^version` at publish time; here we only advance real ranges.
    for (const field of DEP_FIELDS) {
      const deps = json[field];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (INTERNAL.has(name) && !String(deps[name]).startsWith("file:")) {
          deps[name] = `^${version}`;
        }
      }
    }

    const nl = text.endsWith("\n") ? "\n" : "";
    writeFileSync(file, JSON.stringify(json, null, 2) + nl);
    console.log(`set ${rel} -> ${version}`);
  }
}

main();
