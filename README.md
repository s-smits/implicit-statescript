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
`node:fs`, `fs.existsSync` and a destructured `existsSync` all count.

The rules come in two tiers, each an Oxlint config in `src/configs/`. The **recommended** tier
(`recommended.json`) holds the rules that define an implicit state machine and find it from the
syntax alone, and whose labelled hits were mostly true (15 of 18). The **opinionated** tier
(`opinionated.json`, which extends the recommended one) adds `prefer-state-union`, a stance that
holds in a codebase that has chosen it and is contested in one that has not: on foreign code about
half of its labelled hits were a state spelled as flags, and the rest were independent options or
unrelated latches. The precision column comes from the measurements below.

Names follow ESLint's convention: a prefix of `no`, `prefer`, `require` or `max` says what kind of
rule it is, and the rest names its subject. Earlier versions called the rules `excessive-bools`
(now `prefer-state-union`), `co-assigned-flags` (`no-coupled-flags`), `files-as-phase`
(`no-marker-file-state`) and `mtime-as-lock` (`no-age-based-lock`), and the scan
`state-literal-spread` (`no-scattered-state-literals`).

| Rule | Reports | Tier | Labelled hits true |
| --- | --- | --- | --- |
| `no-coupled-flags` | fields written so that at most one is set: together each time, by exclusive comparisons, or as opposite literals | recommended | 7 of 8 |
| `no-marker-file-state` | a phase decided by which files the module writes in one folder | recommended | 3 of 4 |
| `no-age-based-lock` | a file's age against a constant, in a function that then deletes, renames or signals | recommended | 5 of 6 |
| `prefer-state-union` | flags a class's methods move apart, a flag derived from two others, or more than three booleans on one record | opinionated | 16 of 29 (the two shapes, foreign code) |

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
returning one), an object spread over a named value (`{ ...state, … }`; a spread of a fresh object
such as `...(c ? { k } : {})` updates nothing), a run of assignments to fields of one object
(`tool.isResizing = true; tool.isRotating = false;`), or a run of one function's `useState`
setters. A field is set when it is written anything but `false`, `null` or `undefined`.

Two shapes show a mode without a count of co-writes. Two fields of one object computed by
comparisons of one subject that cannot both hold (`isResizing: tool !== "rotation"` beside
`isRotating: tool === "rotation"`, or `kind === "file"` beside `kind === "dir"`; `&&` joins are read
conjunct by conjunct) are reported at that object. Two fields written as opposite literals in
objects of one file (`{ imported: true, frozen: false }` and the reverse) and never both `true` are
reported at the first such object, unless the objects are handed straight to a call, as options
are. Not reported: a config object created whole and passed on, fields set together (`{ x, y }`),
comparisons of two different subjects, equalities to two names that can hold one value
(`isFirst: i === start` beside `isLast: i === end`), and a reset that clears every field.

Options: `fields` (least cluster size, default 2), `writes` (least co-writes of each pair, default
3), `exclusive` (share of co-writes that must set at most one field, default 0.9), and `setters`
(functions and methods that write a state record from an object beside the `set*` convention,
such as a store's `update` or an editor's `updateInstanceState`; empty by default).

### `no-marker-file-state`

One function that decides a phase by which files exist in one folder gives the phase no owner.

```ts
// Bad
export const finish = (dir: string) => [writeFileSync(join(dir, "done.json"), ""), rmSync(join(dir, "lock"))];
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
(`paths.lock`, `paths.report`), or a `const` bound to one of those. At least one of the files must
be written, copied, made, removed or renamed by a call in the same module (a call named
`writeFile`, `copyFile`, `cp`, `mkdir`, `rm`, `unlink`, `rename` and their kin, with or without
`Sync`, or any whose name begins with `write`), naming it
directly or through the `const` bound to its path: a phase is recorded by the process that reads
it. Not reported: a single guard (`if (!existsSync(dir)) mkdirSync(dir)`), files in two folders,
one file checked twice, files the module only probes (which lockfile a project has, which candidate
source resolves), and a check that only creates what is missing (`if (!existsSync(readme))
copyFileSync(template, readme)`), which converges on a rerun and so decides no phase.

Options: `fsWrappers` (functions from another module that ask whether a path exists, such as a
`hasMarker(dir, name)`; with two or more arguments the last is the file and the rest the folder),
`stateDirs` (folders whose files are a process's state, such as `runDir`, matched against any
identifier of the path; in one of those a single deciding check is reported, whichever module
writes the file), and `files` (distinct
files of one folder that make a phase elsewhere, default 2). The lists are empty by default.

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
a file time compared with a difference, in a function that takes something over on the strength of
it: it deletes, renames or signals (`rm`, `unlink`, `rmdir`, `remove`, `rename`, `kill`, each in
its sync form too), directly or through a function of the same file that does. File times are
`mtimeMs`, `ctimeMs`, `mtime` and `ctime` of Node's `fs.Stats` (`statSync`, `fs.promises.stat`,
`lstat`, and the same through Bun's and Deno's Node layers), read as `.mtimeMs`,
`.mtime.getTime()`, `+stat.mtime` or `Number(stat.mtime)`, and Bun's `Bun.file(p).lastModified`.
Not reported: an age that only selects what a report shows or a cache keeps (`files.filter((f) =>
now - statSync(f).mtimeMs < RECENT)`), "newer than" (`stat.mtimeMs > lastRun`, a cache question),
an age that is printed, and an elapsed time that reads no file.

Options: `fsWrappers` (functions from another module that return a file's time, such as
`mtimeOf(path)`, so their result counts as a file time) and `processReaders` (functions that ask
whether a process lives, such as `isAlive(pid)`; a function that calls one asks the holder, so its
age test is a fallback and is not reported). Both are empty by default.

### `prefer-state-union` (opinionated)

Booleans that are one state spelled as flags admit combinations nobody means. The rule reads two
shapes from what the code does with the flags, and a count ported from Clippy's
`struct_excessive_bools` and `fn_params_excessive_bools`.

```ts
// Bad
class Server {
  started = false;
  closed = false;
  start() { this.started = true; }
  close() { this.closed = true; }
}

// Good
class Server {
  phase: "created" | "started" | "closed" = "created";
  start() { this.phase = "started"; }
  close() { this.phase = "closed"; }
}
```

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

The shapes: a class whose methods, the constructor aside, move two or more of its boolean fields at
different times (a lifecycle held as flags), and an object holding a flag derived by `||` or `&&`
from two of its own other fields (`{ either: h || v, horizontal: h, vertical: v }`), where the
declared return type or the sources' comparisons say the fields are flags. Flags the same methods
always move together (modifier keys copied off one event), fields only the constructor sets, and a
default (`title || name`) are not reported.

The count reads required `boolean` (or `true | false`, with `null` or `undefined` beside them)
members of an interface, object type literal or class, a class field initialised to `true` or
`false`, and the boolean `useState` cells of one function (React's and Preact's `useState(false)`
or `useState<boolean>()`), and reports more than `max` of them. Optional members do not count: a
record of `minify?`, `sourcemap?` is a set of independent settings. A member typed as one literal
(`procedure: true`) is a brand and a `readonly` field given a literal is a constant, so neither
counts. A class already reported as a lifecycle is not counted again. Declaration files (`.d.ts`)
are not read.

Options: `max` (booleans allowed on a record, default 3, as Clippy; `null` turns the record count
off and leaves the two shapes), `params` (boolean parameters allowed on a function, default 3;
`null` turns the function half off for a repository that already reports boolean parameters
another way), and `ignore` (records, classes, components and functions the repository reads as
settings rather than state, such as `TldrawOptions` or `*Props`; a derived flag is ignored by the
function that builds its object; empty by default). A function is named by its declaration, the
`const` it is bound to, or the method or property key it is the value of. The message names the
record or function, so a hit can be copied into `ignore`.

Every list option matches names, with `*` standing for any run of characters (`*Options`).

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

Flags: `--readers <n>` (other files that must group a set, default 2), `--state-types <a,b>`
(declared sets the repository holds to be states, such as `JobState` or `Task.status`: each is read
as a state whatever its writes show, and reported from one reader on), `--owners <a,b>` (functions
that already compute a grouping, such as `isTerminal`: a grouping inside one is no reader, and the
same grouping spelled elsewhere is reported at the owner from one place on), `--config <file>` (an
Oxlint config whose `settings["implicit-state"]` holds `readers`, `stateTypes` and `owners`, so the
scan reads the same file as the rules; a flag beside it wins), `--enumerations`, `--json` (an array
of `{ rule, file, line, message, places }`), and `--error` (exit 1 on a state finding, for a gating
check). A flag the command does not take, or a folder that is not there, exits 2 with the usage.
Folders named `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `vendored`,
`third_party`, `third-party` or `generated`, and every dot folder, are skipped. The scan runs under
Bun, which strips the types; it needs TypeScript 5 installed under the alias `typescript5`.

## Install

Vendor the source, as anti-slop recommends: copy `src/` into your repository (for example as
`vendor/implicit-statescript/src/`, leaving out the `*.test.ts` files) and install the runtime
dependencies:

```sh
bun add -d oxlint@1.83.0 @oxlint/plugins@1.83.0
bun add -d typescript5@npm:typescript@5.9.3   # only for the scan
```

Then register the plugin. The simplest way is to extend one of the shipped configs, which loads the
plugin and turns its tier's rules on at `warn`. In `.oxlintrc.json`:

```json
{
  "extends": ["./vendor/implicit-statescript/src/configs/recommended.json"]
}
```

Extend `opinionated.json` instead to add `prefer-state-union`, and override a rule's options in your
own `rules` as usual. Each config names the plugin relative to itself, so the vendored folder can sit
anywhere.

With `oxlint.config.ts`, register the plugin and the rules by hand:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [{ name: "implicit-state", specifier: "./vendor/implicit-statescript/src/index.ts" }],
  rules: {
    "implicit-state/no-coupled-flags": "warn",
    "implicit-state/no-marker-file-state": "warn",
    "implicit-state/no-age-based-lock": "warn",
    // The opinionated tier:
    // "implicit-state/prefer-state-union": ["warn", { "max": 3, "params": 3 }],
  },
});
```

Then run Oxlint as usual, for example `bunx oxlint src` or `npx oxlint src`. Oxlint loads the
plugin's TypeScript through Node's type stripping, which needs Node 22.18 or later; where Node is
older or absent, run it under Bun instead with `bun x --bun oxlint src`. The vendored `src/` holds a
`package.json` that marks it as an ES module, so keep it when copying, or Node warns on every run.

Keep every rule at `warn` at first: each reports shapes that are sometimes deliberate, and the
measured precision below rests on small labelled counts. Raise a rule to `error` once its reports on
your code have been read and found worth acting on.

Both forms were run with Oxlint 1.83.0 over `examples/` from a vendored copy. The plugin is
wrapped in `eslintCompatPlugin`, as anti-slop's is, but only Oxlint is tested.

`skills/install-implicit-statescript/SKILL.md` gives a coding agent the same steps.

## Tailoring to one repository

The rules are generic: they infer structure from syntax and name nothing of any one codebase. That
is also their limit. Whether four booleans are a mode or four independent settings, whether a set of
literals is a lifecycle or a list of kinds, and which local helper wraps `existsSync` are facts of
one repository, and each is an option above. `survey` proposes them:

```sh
bun vendor/implicit-statescript/src/scan/cli.ts survey src   # --json for the report as data
```

It reads the tree's syntax and, where the question is about types, the TypeScript checker over the
same files, and proposes:

- for `prefer-state-union` `ignore`, a record with more than three required booleans none of which
  is written in an update the checker traces to it (read once set, as settings are), and a
  `*Suffix` pattern where three or more such records share a last word;
- for `no-coupled-flags` `setters`, a function or method outside `set*` whose callers discard its
  result and hand it objects whose flags change from call to call;
- for `no-marker-file-state` `fsWrappers` and `no-age-based-lock` `fsWrappers` and
  `processReaders`, a short function that forwards its parameter to the platform and hands back the
  answer, called from its own file or from files that import it; `stateDirs`, a folder holding a
  file written as JSON and read back;
- for the scan's `stateTypes`, an exported set of literals written in an update and grouped by hand
  in other files, and for `owners`, an exported function typed as returning a boolean or literal
  union that groups a parameter's field which other places spell again by hand.

A name (`*State`, `isFile`, `update*`) only ranks a proposal; it never makes one. Each proposal comes
with its evidence (file and line) and the hits adopting it would add or remove, measured by running
the rules and the scan both ways, and the report ends with a config fragment adopting every
proposal that changes a hit. Wrappers of `git` and helpers named as locks are noted, since no option
reads them.

The survey proposes; it does not decide. On two projects of different kinds, with every proposal
read against the code and adopted or rejected as an owner would:

| Project (commit) | files | survey | hits at defaults | adopted | hits after | removed hits judged false | added hits judged true |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pnpm (`a0192007c`) | 2246 | 5.6 s | 46 | 8 of 11 `ignore` (one pattern narrowed), 0 of 2 `stateTypes`, 4 of 4 `owners` | 28 | 22 of 22 | 4 of 4 |
| tldraw (`69f43954f`) | 2890 | 6.4 s | 33 | 11 of 12 `ignore`, 3 of 12 `stateTypes` | 25 | 10 of 11 (one borderline) | 3 of 3 |

The survey was measured before `prefer-state-union` read its two shapes and before the other rules
were narrowed, so its hit counts are those of that version. The judgements are one reader's, not an
independent labelling. Where a proposal was wrong, it was
wrong in ways worth knowing: a record updated through a method that takes a `Partial` of it, which
the checker without the library cannot trace, was proposed as settings; most `stateTypes` proposals
on tldraw were kinds (an arrow's type, a dash style) whose "write" was an option passed through; and
the four `owners` hits on pnpm were true duplicates of a grouping but group error codes, not states.
Adopted unread, the proposals would also have silenced hits judged true (on tldraw a licence record
beside an existing state union; on pnpm a context whose lockfile flags are one state and three plan
records whose flags imply each other) and reported eleven sets of kinds as states. Read each one.

`examples/export.ts` holds a settings record the rule reports at its defaults, and
`examples/tailored.oxlintrc.json` adopts the survey's proposal for it.

### The opinionated tier

The package ships an opinionated config with one rule, `prefer-state-union`, whose labelled hits
on foreign code were right about half the time. A repository makes its own opinionated tier the same
way: adopt facts, label a sample of the resulting hits, and keep a rule only where the labels show it
is right at least half the time, with the labels kept beside the config so the choice can be
measured again. `skills/tailor-implicit-statescript/SKILL.md` gives a coding agent the procedure:
one proposal at a time, with the evidence and a recommendation, to the repository's owner. The
recommended config stays generic.

## Measured precision

The numbers come from an evaluation of the rules in the source project, over two labelled corpora.
The first holds 365 items over 127 source trees (the source project's head and 62 of its history
trees, three foreign projects at fixed commits with the parents of commits that fixed an implicit
state there, and 13 synthetic mutants). Its items were labelled from a manual review, from history
(the tree before a fix is positive, the fix negative), from hand-written hard negatives, and by
reading the code at every detector hit. Its foreign projects are
[excalidraw](https://github.com/excalidraw/excalidraw) (`701b901a0`),
[vite](https://github.com/vitejs/vite) (`a579e352a`) and
[changesets](https://github.com/changesets/changesets) (`2f6995d5b`). The second holds 493 labelled
items on eight foreign projects: excalidraw, vite, bullmq, hono, pnpm, rollup, tldraw and trpc.

Precision is the share of a rule's hits on labelled items that were true, pooled over both corpora;
recall is the positive items of the rule's class that it reports. A history tree counts once, so a
site unchanged across trees counts in each.

| Rule | Labelled hits true | Recall where measured |
| --- | --- | --- |
| `no-coupled-flags` | 7 of 8 | source project 1 of 3, excalidraw 2 of 7 |
| `no-marker-file-state` | 3 of 4 | source project 2 of 6, synthetic 1 of 1 |
| `no-age-based-lock` | 5 of 6 | source project 2 of 3, vite 1 of 1 |
| `prefer-state-union`, the two shapes | 16 of 29, all on foreign code | excalidraw 3 of 4, vite 2 of 5, source project 0 of 7 |
| `prefer-state-union`, the count | source project: 4 of 8 at more than two booleans, 1 of 5 at more than three | source project 3 of 7 at more than two |
| `no-scattered-state-literals` (scan) | 9 of 11 | source project 4 of 10, excalidraw 7 of 9, synthetic 1 of 3 |

These rest on small labelled counts: no rule has more than 29 judged hits, and the three
recommended rules have eight or fewer each, so one hit more or less moves a figure by more than ten
points. Read them as the order of magnitude, not as a rate to hold a rule to.

How to read them:

- **`no-scattered-state-literals`** is the best measured. Swept over every tree, at 2 other files it
  reads recall 55% and precision 83%, and at 3 files 41% and 88%. The state-or-enumeration split is
  what makes it usable: without it no threshold reached 80% precision (the best was 43%), and the
  split removed six false hits and no true one. Known misses: a literal assigned through a local
  variable before the field write, and a reply's discriminant (vite's fetch result type) read as a
  state.
- **`no-coupled-flags`** caught 1 of 10 labelled positives while it counted only fields written
  together three times; reading exclusive comparisons and opposite literals as one mode raised that
  to 3 of 10 with no labelled negative hit in the first corpus. Its one false hit, in the second, is
  a client that also sets one of the two fields on its own elsewhere. Most of the misses are out of reach of one file: a reset whose
  mode shows in another file, or a type declaration.
- **`no-marker-file-state`** lost its one false hit in the first corpus, a create-if-missing
  set-up, once it skipped a check whose only branch creates the same file, and went from 3 of 8
  labelled hits true to 3 of 4 once it required the module to write or remove the files it tests.
  The files a module only probes (which lockfile a project has, which candidate source resolves)
  were the false hits. The one left is a function that renames the executable it probes.
- **`no-age-based-lock`** went from 2 of 5 hits true in the source project to 2 of 3 once it
  required the function to delete, rename or signal; the hits it dropped compared an age only to
  choose what a report prints.
- **`prefer-state-union`** is opinionated. As a count of booleans, precision was 33% to 45% on
  every tree at two or more, and no limit reached 80% without losing nearly all recall: a count
  cannot tell a set of independent options from a mode. The two shapes do better, but large
  classes keep unrelated latches that their methods also move at different times, and most of the 13
  false hits among the 29 were such latches. It no longer counts a member typed as one literal
  (a brand or a discriminant) or a `readonly` field given a literal (a constant), which removed
  thirteen labelled negatives across hono, pnpm, rollup, tldraw and trpc with recall unchanged.

Limits of these figures: beyond their small size, most `prefer-state-union` hits on the foreign
trees of the first corpus (108 on excalidraw's history, 49 on vite's) were never labelled, so its
foreign precision is a sample. The rules were written and narrowed against these corpora, so none
of them is a held-out measurement; the figures say how the rules did on the code they were tuned on.

### Counts on other projects, unjudged

For scale, every rule of the opinionated config and the scan at their defaults over the heads of
other open-source TypeScript projects. These hits were counted, not read, so they say how much a rule reports, not
how often it is right.

| Project (commit) | files linted | no-coupled-flags | prefer-state-union | no-marker-file-state | no-age-based-lock | scan: state / enumeration |
| --- | --- | --- | --- | --- | --- | --- |
| excalidraw (`701b901a0`) | 723 | 3 | 15 | 0 | 0 | 7 / 2 |
| vite (`a579e352a`) | 1681 | 2 | 3 | 0 | 1 | 1 / 1 |
| changesets (`2f6995d5b`) | 166 | 0 | 0 | 0 | 0 | 0 / 0 |
| bullmq (`b18b6ddd`) | 262 | 0 | 8 | 0 | 0 | 0 / 0 |
| hono (`61f7c59e`) | 459 | 0 | 1 | 0 | 0 | 0 / 1 |
| pnpm (`a0192007c`) | 2681 | 6 | 36 | 1 | 1 | 5 / 3 |
| rollup (`f92bf715d`) | 13118 | 2 | 9 | 0 | 0 | 0 / 1 |
| tldraw (`69f43954f`) | 2996 | 2 | 34 | 0 | 0 | 7 / 4 |
| trpc (`8f4826679`) | 1160 | 1 | 1 | 0 | 0 | 1 / 0 |

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
recommended config reports four warnings there (two `no-coupled-flags`, one `no-marker-file-state`,
one `no-age-based-lock`), the opinionated config seven (three more from `prefer-state-union`), and
`examples/tailored.oxlintrc.json` six; the scan reports one state spread (`examples/orders/`).
`test/plugin.test.ts` checks these counts.

## Licence

MIT; see `LICENSE`. `prefer-state-union` is ported from Clippy and from `rust-excessive-bools-lint`,
and `src/shared/flags.ts` from Foxglove's ESLint plugin; their notices are in
`THIRD_PARTY_NOTICES.md`.
