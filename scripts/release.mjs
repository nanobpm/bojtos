#!/usr/bin/env node
// Publish the two Bojtos npm packages in dependency order:
//
//   @nanobpm/bojtos-kit  →  @nanobpm/bojtos-react
//
// (@nanobpm/engine-wasm is an *external* npm dependency published from the
// nano-bpm repo — it is not part of this monorepo and is not touched here.)
//
// Inside the repo, bojtos-react links bojtos-kit as an npm workspace. If a
// contributor pins it as a `file:` link instead, npm can't publish that, so
// this script rewrites each internal `@nanobpm/*` `file:` dependency to
// `^<version>` at publish time and restores the original package.json
// afterwards. A `^x.y.z` range (the default here) is published verbatim.
//
// The same script drives both the maintainer's initial local publish (npm auth
// via `npm login` / an automation token, OTP prompted interactively) and the
// tag-triggered CI workflow (npm auth via OIDC trusted publishing — no token).
//
// Usage:
//   node scripts/release.mjs [--dry-run] [--tag <dist-tag>] [-- <extra npm publish args>]
//
// The version is taken from @nanobpm/bojtos-kit's package.json; bojtos-react
// must already declare the same version (bump both together) or the script
// aborts.
//
// Provenance is controlled by the environment (NPM_CONFIG_PROVENANCE): the
// release workflow sets it to `true` (this repo is public, so npm can attach a
// provenance statement). A local publish leaves it unset (provenance off),
// since a maintainer laptop has no OIDC token to sign with.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Publish order matters: a package must be published before anything that
// pins it, so consumers can always resolve the pinned version.
const PACKAGES = [
  { name: "@nanobpm/bojtos-kit", dir: "bojtos-kit", artifact: "dist/index.js" },
  { name: "@nanobpm/bojtos-react", dir: "bojtos-react", artifact: "dist/index.js" },
];
const INTERNAL = new Set(PACKAGES.map((p) => p.name));

function parseArgs(argv) {
  const opts = { dryRun: false, tag: null, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--tag") {
      opts.tag = argv[++i];
      if (opts.tag === undefined) {
        console.error("Missing value for --tag");
        process.exit(2);
      }
    } else if (a === "--") {
      opts.passthrough = argv.slice(i + 1);
      break;
    } else if (a === "--help" || a === "-h") opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function readPkg(dir) {
  const file = join(root, dir, "package.json");
  const text = readFileSync(file, "utf8");
  return { file, text, json: JSON.parse(text) };
}

/** Rewrite internal `@nanobpm/*` `file:` deps to `^version`. Returns the
 *  original file text so the caller can restore it. */
function pinInternalDeps(pkg, version) {
  const { file, text, json } = readPkg(pkg.dir);
  let changed = false;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = json[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (INTERNAL.has(name) && String(spec).startsWith("file:")) {
        deps[name] = `^${version}`;
        changed = true;
      }
    }
  }
  if (changed) {
    const nl = text.endsWith("\n") ? "\n" : "";
    writeFileSync(file, JSON.stringify(json, null, 2) + nl);
  }
  return text;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: node scripts/release.mjs [--dry-run] [--tag <dist-tag>] [-- <extra npm publish args>]",
    );
    return;
  }

  // bojtos-kit is the version anchor for the release train.
  const anchor = readPkg(PACKAGES[0].dir).json;
  const version = anchor.version;
  if (!version) {
    console.error(`No version in ${PACKAGES[0].dir}/package.json`);
    process.exit(1);
  }

  // Both must agree; publishing mixed versions would leave bojtos-react's
  // pinned `^version` dep pointing at a bojtos-kit that doesn't exist.
  const mismatched = PACKAGES.filter((p) => readPkg(p.dir).json.version !== version);
  if (mismatched.length) {
    console.error(
      `Version mismatch — expected ${version} everywhere, but:\n` +
        mismatched.map((p) => `  ${p.name}: ${readPkg(p.dir).json.version}`).join("\n") +
        `\nBump both packages to the same version before releasing.`,
    );
    process.exit(1);
  }

  // Fail early if a build artifact is missing (the packages ship prebuilt
  // dist/; a forgotten `npm run build` would otherwise publish an empty one).
  for (const p of PACKAGES) {
    if (!existsSync(join(root, p.dir, p.artifact))) {
      console.error(
        `Missing ${p.dir}/${p.artifact} — run \`npm run build\` before releasing.`,
      );
      process.exit(1);
    }
  }

  console.log(
    `Releasing Bojtos packages @ ${version}${opts.dryRun ? " (dry run)" : ""}` +
      `${opts.tag ? ` [dist-tag: ${opts.tag}]` : ""}\n`,
  );

  for (const p of PACKAGES) {
    const cwd = join(root, p.dir);
    const original = pinInternalDeps(p, version);
    try {
      const args = ["publish", "--access", "public"];
      if (opts.dryRun) args.push("--dry-run");
      if (opts.tag) args.push("--tag", opts.tag);
      args.push(...opts.passthrough);
      console.log(`\n=== ${p.name} (${p.dir}) ===`);
      // Provenance is inherited from the environment (NPM_CONFIG_PROVENANCE):
      // the release workflow sets it true; a local publish leaves it off.
      execFileSync("npm", args, { cwd, stdio: "inherit" });
    } finally {
      // Always restore the committed dependency spec, even on failure.
      writeFileSync(readPkg(p.dir).file, original);
    }
  }

  console.log(
    `\n✓ ${opts.dryRun ? "Dry run complete" : `Published all Bojtos packages @ ${version}`}.`,
  );
}

main();
