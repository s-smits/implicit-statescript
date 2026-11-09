# Repository guidance

- `src/` is the plugin and the scan as a repository vendors them; `test/` holds the shared test
  helpers.
- `examples/` holds small programs the README's counts are read from; change the README with them.
- Keep every rule generic: infer structure from the syntax, recognise the platform's own APIs, and
  add no application-specific names, paths or exceptions. A list a rule needs is an option with a
  generic default.
- Use Oxlint's ESTree API for rules. The scan alone uses the TypeScript compiler API, through the
  `typescript5` alias.
- Give each semantic change a case in the rule's `RuleTester` suite, with its nearest hostile
  negative as a valid case beside it.
- Keep the README's examples equal to each rule's `meta.docs.examples`; `test/examples.test.ts`
  lints them.
- Run `bun run check` before committing.
