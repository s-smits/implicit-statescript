#!/usr/bin/env bun
/**
 * `implicit-statescript scan [dir]`: the whole-tree scan, over every TypeScript file under a folder.
 * `implicit-statescript survey [dir]`: the facts about the tree the rules and the scan take as
 * options, each with its evidence and the hits adopting it would add or remove (`survey.ts`).
 *
 *   --readers <n>          how many files besides the owner must group a set by hand (default 2)
 *   --state-types <a,b>    declared sets the repository holds to be states
 *   --owners <a,b>         functions that already compute a grouping
 *   --config <file>        an Oxlint config whose `settings["implicit-state"]` holds `readers`,
 *                          `stateTypes` and `owners`; a flag given beside it wins
 *   --enumerations         also print the sets read as enumerations of kinds rather than states
 *   --json                 print one JSON array of { rule, file, line, message, places }, or the
 *                          survey's report as one JSON object
 *   --error                exit 1 when a state finding is printed, for a gating check
 *
 * Folders named `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `vendored`,
 * `third_party` or `generated`, and every dot folder, are skipped; test files are read by no rule.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { asRecord, isNumber, type JsonValue, stringsOf } from "../shared/values.ts";
import { type Finding, READER_FLOOR, type ScanOptions, scatteredLiterals } from "./scattered-literals.ts";
import { sourcesUnder } from "./sources.ts";
import { printedSurvey, surveyed } from "./survey-hits.ts";

const USAGE =
  "usage: implicit-statescript scan [dir] [--readers <n>] [--state-types <a,b>] [--owners <a,b>] [--config <file>] [--enumerations] [--json] [--error]\n" +
  "       implicit-statescript survey [dir] [--json]\n";
const VALUED = new Set(["--readers", "--state-types", "--owners", "--config"]);

/** The command line split into its positional words, its valued flags and its switches. */
function parsed(words: readonly string[]): { positional: string[]; values: Map<string, string>; switches: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at] ?? "";
    if (VALUED.has(word)) {
      values.set(word, words[at + 1] ?? "");
      at += 1;
    } else if (word.startsWith("--")) {
      switches.add(word);
    } else {
      positional.push(word);
    }
  }
  return { positional, values, switches };
}

/** The scan's options from an Oxlint config's `settings["implicit-state"]`: JSON with comments, or
 *  a module whose default export is the config. */
async function configured(path: string | undefined): Promise<JsonValue | undefined> {
  if (path === undefined) {
    return undefined;
  }
  const config: unknown = /\.[cm]?[jt]s$/u.test(path)
    ? ((await import(resolve(path))) as { default: unknown }).default
    : Bun.JSONC.parse(readFileSync(path, "utf8"));
  return asRecord(asRecord(asRecord(config)?.settings)?.["implicit-state"]) ?? undefined;
}

function printed(rows: readonly Finding[], files: number, root: string): string {
  const lines = [...Map.groupBy(rows, (row) => row.kind)].flatMap(([kind, under]) => [
    "",
    `${kind} (${String(under.length)})`,
    ...under.flatMap((row) => [
      `  ${row.path}:${String(row.line)}  ${row.detail}`,
      ...row.places.slice(1).map((place) => `      ${place.path}:${String(place.line)}`),
    ]),
  ]);
  return `${String(files)} files read under ${root}\n${lines.join("\n")}\n`;
}

const [command, ...rest] = argv.slice(2);
if (command !== "scan" && command !== "survey") {
  stdout.write(USAGE);
  exit(command === undefined || command === "--help" ? 0 : 2);
}
const { positional, values, switches } = parsed(rest);
if (command === "survey") {
  const root = positional[0] ?? ".";
  const report = surveyed(root, sourcesUnder(root), (path) => readFileSync(join(root, path), "utf8"));
  stdout.write(switches.has("--json") ? `${JSON.stringify(report)}\n` : printedSurvey(report, root));
  exit(0);
}
const settings = asRecord(await configured(values.get("--config"))) ?? {};
const list = (flag: string, key: string): string[] => {
  const given = values.get(flag);
  return given === undefined ? stringsOf(settings[key]) : given.split(",").filter((one) => one !== "");
};
const readers = values.has("--readers") ? Number(values.get("--readers")) : isNumber(settings.readers) ? settings.readers : READER_FLOOR;
if (!Number.isInteger(readers) || readers < 1) {
  stdout.write(USAGE);
  exit(2);
}
const options: ScanOptions = { readers, stateTypes: list("--state-types", "stateTypes"), owners: list("--owners", "owners") };
const root = positional[0] ?? ".";
const files = sourcesUnder(root);
const rows = scatteredLiterals(files, options).filter((row) => switches.has("--enumerations") || row.kind === "no-scattered-state-literals");
if (switches.has("--json")) {
  const found = rows.map((row) => ({ rule: row.kind, file: row.path, line: row.line, message: row.detail, places: row.places }));
  stdout.write(`${JSON.stringify(found)}\n`);
} else {
  stdout.write(printed(rows, files.size, root));
}
exit(switches.has("--error") && rows.some((row) => row.kind === "no-scattered-state-literals") ? 1 : 0);
