import { eslintCompatPlugin } from "@oxlint/plugins";

import { coAssignedFlagsRule } from "./rules/co-assigned-flags.ts";
import { excessiveBoolsRule } from "./rules/excessive-bools.ts";
import { filesAsPhaseRule } from "./rules/files-as-phase.ts";
import { mtimeAsLockRule } from "./rules/mtime-as-lock.ts";

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
 * Every rule reports and none fixes: naming the states is the change.
 */
const implicitStatePlugin = eslintCompatPlugin({
  meta: { name: "implicit-state" },
  rules: {
    "co-assigned-flags": coAssignedFlagsRule,
    "excessive-bools": excessiveBoolsRule,
    "files-as-phase": filesAsPhaseRule,
    "mtime-as-lock": mtimeAsLockRule,
  },
});

export default implicitStatePlugin;
