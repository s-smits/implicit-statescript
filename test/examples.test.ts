/**
 * Each rule's `meta.docs.examples`: the `before` its own rule reports once, and the `after` it
 * passes. The README shows the same pairs, so a pair that stops holding fails here first.
 */
import plugin from "../src/index.ts";
import type { RuleExample } from "../src/shared/values.ts";
import { RuleTester } from "./rule-tester.ts";

const tester = new RuleTester();

for (const [id, rule] of Object.entries(plugin.rules)) {
  const examples = (rule.meta?.docs?.examples ?? []) as RuleExample[];
  const filename = id === "no-coupled-flags" || id === "prefer-state-union" ? "example.tsx" : "example.ts";
  tester.run(`implicit-state/${id}`, rule, {
    valid: examples.map(({ after }) => ({ name: `example after: ${after.split("\n")[0] ?? ""}`, code: after, filename })),
    invalid: examples.map(({ before }) => ({
      name: `example before: ${before.split("\n")[0] ?? ""}`,
      code: before,
      filename,
      errors: 1,
    })),
  });
}
