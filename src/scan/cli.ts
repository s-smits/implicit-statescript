#!/usr/bin/env bun
/**
 * `implicit-statescript scan [dir]`: the whole-tree scan, over every TypeScript file under a folder.
 *
 *   --readers <n>    how many files besides the owner must group a set by hand (default 2)
 *   --enumerations   also print the sets read as enumerations of kinds rather than states
 *   --json           print one JSON array of { rule, file, line, message, places }
 *   --error          exit 1 when a state finding is printed, for a gating check
 *
 * Folders named `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `vendored`,
 * `third_party` or `generated`, and every dot folder, are skipped; test files are read by no rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, exit, stdout } from "node:process";
import { type Finding, scatteredLiterals, READER_FLOOR } from "./scattered-literals.ts";

const SKIPPED_DIRECTORY = /^(?:node_modules|dist|build|out|coverage|vendor|vendored|third[-_]party|generated)$|^\./u;
const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;
const USAGE = "usage: implicit-statescript scan [dir] [--readers <n>] [--enumerations] [--json] [--error]\n";

/** Every TypeScript file under a folder that the scan reads, by its path relative to the folder. */
function sourcesUnder(root: string, at = root, files = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORY.test(entry.name)) {
      sourcesUnder(root, path, files);
    } else if (entry.isFile() && SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      files.set(relative(root, path), readFileSync(path, "utf8"));
    }
  }
  return files;
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
if (command !== "scan") {
  stdout.write(USAGE);
  exit(command === undefined || command === "--help" ? 0 : 2);
}
const at = rest.indexOf("--readers");
const readers = at === -1 ? READER_FLOOR : Number(rest[at + 1]);
if (!Number.isInteger(readers) || readers < 1) {
  stdout.write(USAGE);
  exit(2);
}
const root = rest.find((argument, index) => !argument.startsWith("--") && (at === -1 || index !== at + 1)) ?? ".";
const files = sourcesUnder(root);
const rows = scatteredLiterals(files, readers).filter((row) => rest.includes("--enumerations") || row.kind === "no-scattered-state-literals");
if (rest.includes("--json")) {
  const found = rows.map((row) => ({ rule: row.kind, file: row.path, line: row.line, message: row.detail, places: row.places }));
  stdout.write(`${JSON.stringify(found)}\n`);
} else {
  stdout.write(printed(rows, files.size, root));
}
exit(rest.includes("--error") && rows.some((row) => row.kind === "no-scattered-state-literals") ? 1 : 0);
