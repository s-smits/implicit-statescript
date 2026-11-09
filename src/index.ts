import { eslintCompatPlugin } from "@oxlint/plugins";

import { noAgeBasedLockRule } from "./rules/no-age-based-lock.ts";
import { noCoupledFlagsRule } from "./rules/no-coupled-flags.ts";
import { noMarkerFileStateRule } from "./rules/no-marker-file-state.ts";
import { preferStateUnionRule } from "./rules/prefer-state-union.ts";

/**
 * Rules that find implicit state machines: a state whose value has no one typed owner.
 *
 * Such a state is spread over several booleans that admit combinations nobody means, over fields
 * whose writers keep at most one of them set, over which files exist in a folder, or over how old
 * a timestamp is. Each reader then re-derives the state its own way, the readers drift apart, and
 * a transition that happens between two of them (a crash between two writes, a slow holder past a
 * threshold) lands in a state no branch expects. The remedy is always one owner: a union or a
 * discriminated union for a value, one record for a process's phase, the holder itself for a lock.
 *
 * Every rule infers its structure from the syntax, names no module, path or helper of any one
 * repository, and matches the platform's own forms (`fs`, `Bun.file`, React's `useState`) or a
 * local wrapper whose body reduces to one. The cross-file shape (one set of string literals
 * compared by hand in several files) needs every file at once and is the scan in `src/scan/`.
 *
 * Every rule reports and none fixes: naming the states is the change. `configs/recommended.json`
 * turns on the rules whose labelled hits were mostly true, and `configs/opinionated.json` adds
 * `prefer-state-union`, whose hits on foreign code were right about half the time.
 */
const implicitStatePlugin = eslintCompatPlugin({
  meta: { name: "implicit-state" },
  rules: {
    "no-age-based-lock": noAgeBasedLockRule,
    "no-coupled-flags": noCoupledFlagsRule,
    "no-marker-file-state": noMarkerFileStateRule,
    "prefer-state-union": preferStateUnionRule,
  },
});

export default implicitStatePlugin;
