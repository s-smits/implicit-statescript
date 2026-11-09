# implicit-statescript

An [Oxlint](https://oxc.rs/docs/guide/usage/linter) plugin, and a small type-aware scan, that find
**implicit state machines** in TypeScript: state that a program has but never names, so no type
says which states exist and no single place moves between them.

It is a sibling of [anti-slop](https://github.com/dmmulroy/anti-slop) in shape: an Oxlint JS plugin
shipped as TypeScript source, meant to be vendored into a repository, with each rule tested beside
its source. It began as the generic tier of the lint plugin in the Anabasis project and was cut
loose from it so that it reads any codebase.

## What an implicit state machine is

A component, process or record is a state machine whenever it moves through a fixed set of
situations (idle, loading, failed, done) and behaves differently in each. The machine is
**explicit** when one value names the state (`status: "idle" | "loading" | "failed" | "done"`) and
the code that changes it is easy to find. It is **implicit** when the state is spelled some other
way:

- as several booleans (`isLoading`, `isError`, `isDone`) that admit combinations which never mean
  anything, such as loading and done at once;
- as which marker files exist in a folder, which a crash between two writes leaves in a combination
  no branch expects;
- as a file's age, read as "its holder died" when it may only be slow;
- as string literals that one type owns but that other files group by hand, so a new state needs
  edits in many places and a missed one compiles.

Each of these works until a combination nobody planned for turns up. The rules below report the
spellings, and the fix is always the same in kind: name the states once and let one owner move
between them. None of the rules has an automatic fix, since which states the spelling stands for
is the change.

## Rules

Every rule reads only syntax (ESTree), skips test files (paths under `test/`, `tests/`,
`__tests__/`, `__mocks__/`, `fixture/` or `fixtures/`, and `*.test.*` or `*.spec.*` files), and
recognises platform APIs by their own names under any receiver or import, so `existsSync` from
`node:fs`, `fs.existsSync` and a destructured `existsSync` all count. The status column comes from
the measurements below.

Names follow ESLint's convention: a prefix of `no`, `prefer`, `require` or `max` says what kind of
rule it is, and the rest names its subject. Earlier versions called the rules `excessive-bools`
(now `prefer-state-union`), `co-assigned-flags` (`no-coupled-flags`), `files-as-phase`
(`no-marker-file-state`) and `mtime-as-lock` (`no-age-based-lock`), and the scan
`state-literal-spread` (`no-scattered-state-literals`).

| Rule | Reports | Status |
| --- | --- | --- |
| `no-coupled-flags` | fields written together where each write sets at most one | generic, low recall |
| `prefer-state-union` | a record, class, `useState` set or signature with more than three booleans | experimental |
| `no-marker-file-state` | a phase decided by which files exist in one folder | generic, one known false shape |
| `no-age-based-lock` | a file's age against a constant deciding whether its holder lives | experimental |

### `no-coupled-flags`

Fields of one state written together, where each write sets at most one of them, are one mode with
no name: nothing stops a later write from setting two.

```ts
// Bad
setState({ isLoading: true, isError: false, isSuccess: false });
setState({ isLoading: false, isError: false, isSuccess: true });
setState({ isLoading: false, isError: true, isSuccess: false });

// Good
setState({ phase: "loading" });
setState({ phase: "success" });
setState({ phase: "error" });
```

A co-write is an object handed to a setter (`setState({ … })`, `this.setState({ … })` or an updater
returning one), an object spread over another (`{ ...state, … }`), a run of assignments to fields
of one object (`tool.isResizing = true; tool.isRotating = false;`), or a run of one function's
`useState` setters. A field is set when it is written anything but `false`, `null` or `undefined`.
Not reported: a config object created whole and passed on, fields set together (`{ x, y }`), and a
reset that clears every field.

Options: `fields` (least cluster size, default 2), `writes` (least co-writes of each pair, default
3), `exclusive` (share of co-writes that must set at most one field, default 0.9).

### `prefer-state-union`

Several booleans on one record are usually one state spelled as flags. Ported from Clippy's
`struct_excessive_bools` and `fn_params_excessive_bools`.

```ts
// Bad
export interface Job {
  queued: boolean;
  running: boolean;
  done: boolean;
  failed: boolean;
}

// Good
export interface Job {
  state: "queued" | "running" | "done" | "failed";
}
```

It counts required `boolean` (or `true`/`false`, with `null` or `undefined` beside them) members of
an interface, object type literal or class, a class field initialised to `true` or `false`, and the
boolean `useState` cells of one function (React's and Preact's `useState(false)` or
`useState<boolean>()`). Optional members do not count: a record of `minify?`, `sourcemap?` is a set
of independent settings. Declaration files (`.d.ts`) are not read.

Options: `max` (booleans allowed on a record, default 3, as Clippy), `params` (boolean parameters
allowed on a function, default 3; `null` turns the function half off for a repository that already
reports boolean parameters another way).

### `no-marker-file-state`

One function that decides a phase by which files exist in one folder gives the phase no owner.

```ts
// Bad
export function phaseOf(dir: string) {
  if (existsSync(join(dir, "done.json"))) return "done";
  return existsSync(join(dir, "lock")) ? "running" : "idle";
}

// Good
export function phaseOf(dir: string): Phase {
  return readState(join(dir, "state.json")).phase;
}
```

Reported: two or more existence checks of distinct files in one folder in one function, each
deciding something (a condition, comparison, return or `const`). An existence check is
`existsSync` (`node:fs`, `fs`), `pathExists` or `pathExistsSync` (`fs-extra`), `Bun.file(p).exists()`,
or a local function whose body only returns one of those of its parameter. The folder is read from
`join(dir, "a")`, `resolve(dir, "a")`, `${dir}/a`, `dir + "/a"`, properties of one paths object
(`paths.lock`, `paths.report`), or a `const` bound to one of those. Not reported: a single guard
(`if (!existsSync(dir)) mkdirSync(dir)`), files in two folders, one file checked twice.

### `no-age-based-lock`

A file's age compared with a constant guesses at its holder's state: a slow holder reads as a dead
one and a second process takes the lock.

```ts
// Bad
const stale = Date.now() - statSync(lock).mtimeMs > STALE_MS;
if (stale) rmSync(lock);
writeFileSync(lock, String(pid), { flag: "wx" });

// Good
const holder = Number(readFileSync(lock, "utf8"));
if (!alive(holder)) rmSync(lock);
writeFileSync(lock, String(pid), { flag: "wx" });
```

Reported: a `<`, `<=`, `>` or `>=` comparison with a difference whose subtrahend is a file time, or
a file time compared with a difference. File times are `mtimeMs`, `ctimeMs`, `mtime` and `ctime` of
Node's `fs.Stats` (`statSync`, `fs.promises.stat`, `lstat`, and the same through Bun's and Deno's
Node layers), read as `.mtimeMs`, `.mtime.getTime()`, `+stat.mtime` or `Number(stat.mtime)`, and
Bun's `Bun.file(p).lastModified`. Not reported: "newer than" (`stat.mtimeMs > lastRun`, a cache
question), an age that is printed, and an elapsed time that reads no file.

## The scan: `no-scattered-state-literals`

A spread of literals needs types, which an Oxlint rule does not have, so it ships as a command over
a whole folder:

```sh
bun vendor/implicit-statescript/src/scan/cli.ts scan src
```

It reports an exported set of string literals (a union type, a discriminated union's tag, an
`as const` array or object, a string `enum` or a `Set` of literals) that two or more other files
group by hand (`status === "paid" || status === "pending"`, `["paid", "shipped"].includes(status)`,
or `case` labels sharing a body in a switch that is not exhaustive), giving the places. An
exhaustive switch does not count. The remedy is a predicate or table in the owner that each reader
calls. With the TypeScript compiler API it then reads whether the set is a **state**, written by
an assignment or a setter somewhere, or an **enumeration** of kinds that is only read (HTTP
methods, compass points, file extensions); only states are reported unless `--enumerations` is
passed.

```text
no-scattered-state-literals (1)
  orders/order.ts:3  `OrderStatus` ("pending" | "paid" | "shipped" | "delivered" | "cancelled") is grouped by hand in 2 other files, as "paid" | "shipped"; "paid" | "pending": give each grouping a name in the owner and call it
      orders/refunds.ts:3
      orders/list.ts:3
```

Flags: `--readers <n>` (other files that must group a set, default 2), `--enumerations`, `--json`
(an array of `{ rule, file, line, message, places }`), and `--error` (exit 1 on a state finding,
for a gating check). Folders named `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`,
`vendored`, `third_party` or `generated`, and every dot folder, are skipped. The scan runs under
Bun, which strips the types; it needs TypeScript 5 installed under the alias `typescript5`.

## Install

Vendor the source, as anti-slop recommends: copy `src/` into your repository (for example as
`vendor/implicit-statescript/src/`, leaving out the `*.test.ts` files) and install the runtime
dependencies:

```sh
bun add -d oxlint@1.83.0 @oxlint/plugins@1.83.0
bun add -d typescript5@npm:typescript@5.9.3   # only for the scan
```

Then register the plugin. Start every rule at `warn`: each reports shapes that are sometimes
deliberate, and the measured precision below is far from that of a type error. Raise a rule to
`error` once its reports on your code have been read and found worth acting on.

With `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [{ name: "implicit-state", specifier: "./vendor/implicit-statescript/src/index.ts" }],
  rules: {
    "implicit-state/no-coupled-flags": "warn",
    "implicit-state/prefer-state-union": "warn",
    "implicit-state/no-marker-file-state": "warn",
    "implicit-state/no-age-based-lock": "warn",
  },
});
```

With `.oxlintrc.json`:

```json
{
  "jsPlugins": [{ "name": "implicit-state", "specifier": "./vendor/implicit-statescript/src/index.ts" }],
  "rules": {
    "implicit-state/no-coupled-flags": "warn",
    "implicit-state/prefer-state-union": ["warn", { "max": 3, "params": 3 }],
    "implicit-state/no-marker-file-state": "warn",
    "implicit-state/no-age-based-lock": "warn"
  }
}
```

Both forms were run with Oxlint 1.83.0 over `examples/` from a vendored copy. The plugin is
wrapped in `eslintCompatPlugin`, as anti-slop's is, but only Oxlint is tested.

`skills/install-implicit-statescript/SKILL.md` gives a coding agent the same steps.

## Measured precision

The numbers come from an evaluation of the rules in the source project: a corpus of 365 labelled
items over 127 source trees (the source project's head and 62 of its history trees, three foreign
projects at fixed commits with the parents of commits that fixed an implicit state there, and 13
synthetic mutants). Items were labelled from a manual review, from history (the tree before a fix
is positive, the fix negative), from hand-written hard negatives, and by reading the code at every
detector hit. The foreign projects are [excalidraw](https://github.com/excalidraw/excalidraw)
(`701b901a0`), [vite](https://github.com/vitejs/vite) (`a579e352a`) and
[changesets](https://github.com/changesets/changesets) (`2f6995d5b`).

Recall is positive items of the rule's class that it reports; precision is hits on labelled items
that were true. A history tree counts once, so a site unchanged across trees counts in each. A dash
means no labelled item of that kind.

| Rule | source project R / P | excalidraw R / P | vite R / P | changesets R / P | synthetic R |
| --- | --- | --- | --- | --- | --- |
| `prefer-state-union` | 5/7, 6/18 | 4/4, 6/17 | 4/5, 5/11 | -, 0/1 | 4/4 |
| `no-marker-file-state` | 2/6, 2/2 | - | - | -, 0/1 | 1/1 |
| `no-age-based-lock` | 2/3, 2/5 | - | 1/1, 1/1 | - | 1/1 |
| `no-coupled-flags` | 0/3, - | 1/7, 1/1 | - | - | - |
| `no-scattered-state-literals` (scan) | 4/10, 2/2 | 7/9, 7/8 | -, 0/1 | - | 1/3 |

How to read them:

- **`no-scattered-state-literals`** is the strongest. Swept over every tree, at 2 other files it reads
  recall 55% and precision 83%, and at 3 files 41% and 88%. The state-or-enumeration split is what
  makes it usable: without it no threshold reached 80% precision (the best was 43%), and the split
  removed six false hits and no true one. Known misses: a literal assigned through a local variable
  before the field write, and a reply's discriminant (vite's fetch result type) read as a state.
- **`no-coupled-flags`** hit no negative, but caught 1 of 10 labelled positives. A flag written as
  a computed boolean (`isResizing: type !== "rotation"`) counts as set, so complementary pairs over
  one discriminant are missed. It is safe at `warn` and quiet.
- **`no-marker-file-state`** was right on 2 of 3 hits on real code. The false hit is a create-if-missing
  set-up (changesets' `init`), which seeds each file only where it is missing and converges on a
  rerun; excluding an existence test whose only branch writes the same path is the planned fix.
- **`no-age-based-lock`** is experimental: 3 of 6 hits were true. The true hits delete or claim what the
  old file guards; each false hit uses the age only to filter what a report shows. Requiring the
  age test to guard a removal, a kill or a claim is the planned narrowing.
- **`prefer-state-union`** is experimental: precision was 33% to 45% on every tree, and the sweep
  reached 80% only at five booleans, with recall 10%. A count cannot tell a set of independent
  options from a mode. Treat its reports as prompts to look, or raise `max`.

Limits of these figures: foreign precision rests on at most about fifteen judged hits per rule per
project, and most `prefer-state-union` hits on the foreign trees (108 on excalidraw's history, 49 on
vite's) were never labelled, so its foreign precision is a sample. The rules were written against
the source project, so its column is not a held-out measurement; the foreign columns are closer to
one.

### Counts on other projects, unjudged

For scale, the plugin and the scan at their defaults over the heads of other open-source
TypeScript projects. These hits were counted, not read, so they say how much a rule reports, not
how often it is right.

| Project (commit) | files linted | no-coupled-flags | prefer-state-union | no-marker-file-state | no-age-based-lock | scan: state / enumeration |
| --- | --- | --- | --- | --- | --- | --- |
| excalidraw (`701b901a0`) | 723 | 1 | 12 | 0 | 0 | 7 / 2 |
| vite (`a579e352a`) | 1681 | 0 | 1 | 0 | 1 | 1 / 1 |
| changesets (`2f6995d5b`) | 166 | 0 | 0 | 1 | 0 | 0 / 0 |
| bullmq (`b18b6ddd`) | 262 | 0 | 3 | 0 | 0 | 0 / 0 |
| hono (`61f7c59e`) | 459 | 0 | 0 | 1 | 0 | 0 / 1 |
| pnpm (`a0192007c`) | 2681 | 0 | 37 | 3 | 1 | 5 / 3 |
| rollup (`f92bf715d`) | 13118 | 1 | 6 | 0 | 0 | 0 / 1 |
| tldraw (`69f43954f`) | 2996 | 1 | 24 | 1 | 0 | 7 / 4 |
| trpc (`8f4826679`) | 1160 | 1 | 0 | 0 | 0 | 1 / 0 |

Linting took about a second or less for each project, and the scan at most two and a half
seconds.

## Development

```sh
bun install
bun run check   # lint, test, typecheck
```

Each rule's tests sit beside it in `src/rules/<rule>.test.ts`, written as `RuleTester` cases (`valid`
and `invalid`, with message ids and lines), and each reported shape has its nearest hostile
negative as a valid case. Oxlint 1.83.0's own `RuleTester` refuses to run under Bun, so
`test/rule-tester.ts` keeps its case shape and runs the cases through the Oxlint command line with
the plugin loaded. `test/examples.test.ts` lints every rule's `meta.docs.examples`, which this
README repeats, so the bad example must report and the good one must pass.

`examples/` holds small programs that show each finding beside a near miss that passes. The
plugin reports six warnings there (two `no-coupled-flags`, two `prefer-state-union`, one
`no-marker-file-state`, one `no-age-based-lock`) and the scan one state spread (`examples/orders/`).

## Licence

MIT; see `LICENSE`. `prefer-state-union` is ported from Clippy and from `rust-excessive-bools-lint`,
and `src/shared/flags.ts` from Foxglove's ESLint plugin; their notices are in
`THIRD_PARTY_NOTICES.md`.
