---
name: tailor-implicit-statescript
description: Fit the implicit-statescript rules and scan to one repository by asking its owner to adopt the facts the survey proposes (settings records, state types, owners, wrappers, state folders), writing each adopted fact as a rule option, and keeping a rule only where the owner's labels show precision of at least 0.5. Use when the generic rules report too much or too little on a repository, when asked to tailor, tune or configure implicit-statescript, or to build a repository's opinionated tier.
---

# Tailor implicit-statescript to a repository

The rules ship generic: they infer structure from syntax and name nothing of any one codebase. A
repository holds facts they cannot infer (which records are settings, which literal sets are
states, which helpers wrap the file system), and each such fact is an option. Adopting facts and
keeping only the rules its owner's labels support is how a repository's **opinionated tier** is
made: the same rules, narrowed or widened by facts true of that repository alone.

Install first (`install-implicit-statescript`). Then:

1. **Run the shipped tiers.** Run Oxlint with the recommended or opinionated config and the scan
   (`bun vendor/implicit-statescript/src/scan/cli.ts scan <dir>`), and keep the hit count of each
   rule as the baseline.
2. **Run the survey**: `bun vendor/implicit-statescript/src/scan/cli.ts survey <dir>` (add `--json`
   to keep it). Each proposal names its option, the value, why, the evidence (file and line) and
   the hits adopting it would add (`+`) or remove (`-`). A proposal that changes no hit can wait.
3. **Ask the owner one proposal at a time**, best first within each option. Show the evidence and
   the hits it moves, read the code at the evidence yourself, and give a recommendation with one
   reason: "adopt: every flag is a separate setting read once", or "reject: the flags imply each
   other, so this is the state the rule is for". Recommend against a proposal whose premise the
   code contradicts (a record updated through a method the survey could not trace, a "state" set
   that is only configuration passed through). Offer to narrow a pattern (`*Context` to one
   record) where only part of it holds. Never adopt without the owner's word.
4. **Write each adopted fact** into the repository's Oxlint config as the option the survey names:
   a rule option under `rules` (`prefer-state-union` `ignore`, `no-coupled-flags` `setters`,
   `no-marker-file-state` `fsWrappers` and `stateDirs`, `no-age-based-lock` `fsWrappers` and
   `processReaders`) or the scan's `settings["implicit-state"]` (`stateTypes`, `owners`), and run
   the scan with `--config <that file>`. Merge with what is there.
5. **Have the owner label a sample.** Run both again. For each rule, show up to ten hits (all of
   them where fewer), and ask for each: true or false, and a one-line reason. Record the labels in
   `.implicit-state-labels.jsonl` at the repository root, one line a hit:
   `{"rule": "...", "file": "...", "line": 12, "label": "true", "reason": "...", "date": "YYYY-MM-DD"}`.
6. **Keep a rule only where labelled precision reaches 0.5** (true labels over all labels for that
   rule). Turn the others off in the config, and say which and why. Report each rule's hits before
   and after tailoring and its precision with its denominator, as "3 of 5 true".
7. **Re-measure later** against the labels file: after a refactor, rerun, label only the hits not in
   the file, and apply step 6 again.

Keep the labels file and the options in the repository, not in the vendored source: they are facts
about the repository, and the vendored copy stays generic so it can be replaced by a newer one.
