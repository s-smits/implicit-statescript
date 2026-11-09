---
name: install-implicit-statescript
description: Vendor the implicit-statescript Oxlint plugin into a TypeScript repository, register its rules at warn, and run the type-aware scattered-literals scan. Use when asked to add implicit state machine checks, find flags or marker files that spell a hidden state, or install implicit-statescript.
---

# Install implicit-statescript

1. Copy `src/` from this repository into the target repository as
   `vendor/implicit-statescript/src/`, leaving out every `*.test.ts` file.
2. Install the runtime dependencies with the target's package manager, pinned as here:
   `oxlint@1.83.0` and `@oxlint/plugins@1.83.0`, and `typescript5@npm:typescript@5.9.3` if the
   scan is wanted.
3. Register the plugin in the target's Oxlint config. In `.oxlintrc.json`, add
   `./vendor/implicit-statescript/src/configs/recommended.json` to `extends`, which loads the plugin
   and sets `implicit-state/no-age-based-lock`, `implicit-state/no-coupled-flags` and
   `implicit-state/no-marker-file-state` to `"warn"`; extend `opinionated.json` instead only if the
   owner also wants `implicit-state/prefer-state-union`. In `oxlint.config.ts`, add
   `{ "name": "implicit-state", "specifier": "./vendor/implicit-statescript/src/index.ts" }` to
   `jsPlugins` and set the same rules to `"warn"`. Merge with the existing config; do not replace
   it.
4. Run Oxlint and read every implicit-state warning before proposing a change. The measured
   precision rests on small labelled counts, and `prefer-state-union` was right on about half of
   its labelled hits, so report hits as places to look, not defects. Raise a rule to `error` only on the owner's
   word.
5. Optionally run the scan, which needs Bun:
   `bun vendor/implicit-statescript/src/scan/cli.ts scan <src folder>`. Add `--error` to gate on it
   in CI, and `--config <the Oxlint config>` once it holds `settings["implicit-state"]`.
6. Where the rules report settings records as states, or miss a helper the repository wraps the
   file system in, offer to tailor them: `tailor-implicit-statescript` runs
   `bun vendor/implicit-statescript/src/scan/cli.ts survey <src folder>` and adopts its proposals
   as options one at a time, on the owner's word.

Each rule has no automatic fix. Where the owner asks for one, name the states in one union or
field, give it one owner that moves between them, and replace the flags, marker files or hand
groupings with reads of that owner.
