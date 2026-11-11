// Guards the release docs against drifting from the release mechanism.
//
// Releases are cut by semantic-release on every push to `main`
// (.github/workflows/release.yml + .releaserc.json): it computes the version,
// stamps the manifests (scripts/set-version.mjs) and pushes the tag. The docs
// once kept describing the older manual flow ("bump both package.json files,
// then push a vX.Y.Z tag") long after the switch. Following them would mean a
// hand-pushed tag racing semantic-release, so the docs are derived-checked
// against the workflow here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const workflow = read(".github/workflows/release.yml");
const releaserc = JSON.parse(read(".releaserc.json"));

const RELEASE_DOCS = {
  "docs/releasing.md": read("docs/releasing.md"),
  "README.md (## Release)": read("README.md").split(/^## Release\s*$/m)[1]?.split(/^## /m)[0] ?? "",
};

// Instructions that belong to the manual tag-driven flow semantic-release replaced.
const MANUAL_RELEASE_STEPS = [
  /git tag v\d/i,
  /git push origin v\d/i,
  /push a tag/i,
  /bump the version in/i,
  /verifies the tag matches/i,
];

test("the release workflow is semantic-release on push to main", () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[\s*main\s*\]/, "release.yml triggers on push to main");
  // Match the executable release step, not any occurrence in the file —
  // comments can keep naming semantic-release while the run command reverts
  // to the manual publisher.
  assert.match(workflow, /run:\s*\.\/node_modules\/\.bin\/semantic-release/, "release.yml runs semantic-release");
  const exec = releaserc.plugins.find((p) => Array.isArray(p) && p[0] === "@semantic-release/exec");
  assert.ok(exec, ".releaserc.json uses @semantic-release/exec");
  assert.match(exec[1].prepareCmd, /scripts\/set-version\.mjs/, "set-version.mjs stamps the version at release time");
});

for (const [name, text] of Object.entries(RELEASE_DOCS)) {
  test(`${name} describes the semantic-release flow`, () => {
    assert.ok(text.trim().length > 0, `${name} has release content`);
    assert.match(text, /semantic-release/, `${name} names semantic-release`);
  });

  test(`${name} does not prescribe a manual tag/version bump`, () => {
    for (const step of MANUAL_RELEASE_STEPS) {
      assert.doesNotMatch(text, step, `${name} still describes the manual release step ${step}`);
    }
  });
}
