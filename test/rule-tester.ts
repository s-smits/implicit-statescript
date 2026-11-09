/**
 * A `RuleTester` for `bun test` that takes the same cases as Oxlint's own (`oxlint/plugins-dev`).
 *
 * Oxlint 1.83.0's `RuleTester` refuses to run under Bun: it checks `globalThis.Bun` and throws
 * before the first case. This one runs the Oxlint CLI instead, once per `run`, over every case
 * staged as a file of its own with the rule switched on for that file alone, and compares each
 * file's diagnostics with the case. So a case passes through the same loader, parser and
 * configuration a repository that vendors the plugin uses, and a test file runs unchanged under
 * Node 22 or later once its import names `oxlint/plugins-dev` instead.
 *
 * It reads the subset of the case shape these suites use: `code`, `name`, `filename`, `options`,
 * and `errors` as a count or as `{ messageId, line? }` entries. A diagnostic's `messageId` is
 * recovered by matching its text against the rule's message templates.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Rule } from "@oxlint/plugins";
import plugin from "../src/index.ts";
import type { JsonValue } from "../src/shared/values.ts";

interface CaseBase {
  readonly name?: string;
  readonly code: string;
  readonly filename?: string;
  readonly options?: readonly JsonValue[];
}

/** An expected diagnostic: its message by id, and optionally the line it starts on. */
interface ExpectedError {
  readonly messageId: string;
  readonly line?: number;
}

type ValidCase = string | CaseBase;

interface InvalidCase extends CaseBase {
  readonly errors: number | readonly ExpectedError[];
}

interface Diagnostic {
  message: string;
  filename: string;
  labels: { span: { line: number } }[];
}

const PLUGIN_ENTRY = resolve(import.meta.dirname, "../src/index.ts");
const OXLINT = resolve(import.meta.dirname, "../node_modules/oxlint/bin/oxlint");

/** Each message id of a rule with a pattern that matches its rendered text. */
function messagePatterns(rule: Rule): [string, RegExp][] {
  return Object.entries(rule.meta?.messages ?? {}).map(([id, template]) => {
    const parts = template.split(/\{\{\s*\w+\s*\}\}/u).map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`));
    return [id, new RegExp(`^${parts.join("[\\s\\S]*?")}$`, "u")];
  });
}

/** Lint every case once and return each case's diagnostics, in case order. */
function lintCases(name: string, cases: readonly CaseBase[]): Diagnostic[][] {
  const [pluginName] = name.split("/");
  const directory = mkdtempSync(join(tmpdir(), "implicit-state-cases-"));
  const staged = cases.map((one, index) => {
    const path = `case-${String(index)}/${one.filename ?? "file.ts"}`;
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), one.code);
    return { path, options: one.options ?? [] };
  });
  const config = {
    categories: { correctness: "off" },
    plugins: [],
    jsPlugins: [{ name: pluginName, specifier: PLUGIN_ENTRY }],
    overrides: staged.map(({ path, options }) => ({ files: [path], rules: { [name]: ["error", ...options] } })),
  };
  writeFileSync(join(directory, "oxlintrc.json"), JSON.stringify(config));
  const child = Bun.spawnSync(
    [process.execPath, OXLINT, "-c", "oxlintrc.json", "--format=json", ...staged.map(({ path }) => path)],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  if (child.exitCode !== 0 && child.exitCode !== 1) {
    throw new Error(`oxlint ended with ${String(child.exitCode)}: ${child.stderr.toString()}`);
  }
  const { diagnostics } = JSON.parse(child.stdout.toString()) as { diagnostics: Diagnostic[] };
  return staged.map(({ path }) => diagnostics.filter((one) => one.filename === path));
}

export class RuleTester {
  /** The upstream tester's configuration, kept for the same call shape; the CLI parses by extension. */
  readonly config: JsonValue;

  constructor(config: JsonValue = {}) {
    this.config = config;
  }

  run(name: string, rule: Rule, tests: { valid: readonly ValidCase[]; invalid: readonly InvalidCase[] }): void {
    const ruleId = name.slice(name.indexOf("/") + 1);
    if (plugin.rules[ruleId] !== rule) {
      throw new Error(`${name} is not the rule the plugin registers under that name`);
    }
    const valid = tests.valid.map((one) => (typeof one === "string" ? { code: one } : one));
    const found = lintCases(name, [...valid, ...tests.invalid]);
    const patterns = messagePatterns(rule);
    const idOf = (message: string): string => patterns.find(([, pattern]) => pattern.test(message))?.[0] ?? message;

    describe(name, () => {
      for (const [index, one] of valid.entries()) {
        it(`valid: ${one.name ?? one.code.slice(0, 60)}`, () => {
          expect(found[index]?.map((diagnostic) => diagnostic.message)).toEqual([]);
        });
      }
      for (const [index, one] of tests.invalid.entries()) {
        it(`invalid: ${one.name ?? one.code.slice(0, 60)}`, () => {
          const actual = (found[valid.length + index] ?? [])
            .map((diagnostic) => ({ messageId: idOf(diagnostic.message), line: diagnostic.labels[0]?.span.line }))
            .toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0));
          if (typeof one.errors === "number") {
            expect(actual).toHaveLength(one.errors);
            return;
          }
          const expected = one.errors.map((error) => ({ messageId: error.messageId, line: error.line }));
          expect(actual.map((error, at) => (expected[at]?.line === undefined ? { ...error, line: undefined } : error))).toEqual(expected);
        });
      }
    });
  }
}
