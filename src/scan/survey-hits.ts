/**
 * The survey's second half: what each proposed fact would change. The rules run through the Oxlint
 * CLI over the tree twice, once at their defaults and once with every proposal adopted, and the
 * scan runs twice in process the same way; each hit that appears or disappears is put down to the
 * proposals that can explain it, read from the hit's own text and the file it sits in. A proposal
 * that changes no hit is kept apart, since adopting it changes nothing a person would see.
 *
 * Oxlint is the one beside the tree (`node_modules/oxlint`) where the tree has it, else the one
 * beside this package; the plugin is this package's own entry, so the survey measures the rules it
 * ships with.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import plugin from "../index.ts";
import { type JsonObject, nameMatcher } from "../shared/values.ts";
import { scatteredLiterals, type ScanOptions } from "./scattered-literals.ts";
import { SKIPPED_NAMES } from "./sources.ts";
import { type Noted, type Proposal, survey, type Target } from "./survey.ts";

/** One hit: the rule or scan kind, where, and its message. */
export interface Hit {
  rule: string;
  path: string;
  line: number;
  message: string;
  /** For a scan finding, the files of the places it names. */
  places?: string[];
}

/** A proposal with the hits adopting it adds and removes. */
export interface Surveyed extends Proposal {
  added: Hit[];
  removed: Hit[];
}

export interface SurveyReport {
  files: number;
  /** Hits at the defaults, and with every proposal adopted. */
  before: number;
  after: number;
  proposals: Surveyed[];
  noted: Noted[];
  /** Changed hits no proposal explains. */
  unexplained: { added: Hit[]; removed: Hit[] };
  /** The Oxlint config fragment that adopts every proposal that changes a hit. */
  config: JsonObject;
  seconds: { survey: number; lint: number; scan: number };
}

const PLUGIN_ENTRY = resolve(import.meta.dirname, "../index.ts");
const PLUGIN = "implicit-state";

/** The Oxlint binary beside the tree, else beside this package. */
function oxlintBinary(root: string): string {
  for (const from of [resolve(root), import.meta.dirname]) {
    try {
      return join(dirname(Bun.resolveSync("oxlint/package.json", from)), "bin/oxlint");
    } catch {
      // not installed here; try the next place
    }
  }
  throw new Error("survey needs oxlint installed beside the tree or beside this package");
}

/** Each rule's options and the scan's settings that adopt the proposals given. */
export function adopted(proposals: readonly Proposal[]): JsonObject {
  const options = new Map<string, Map<string, string[]>>();
  for (const { target, value } of proposals) {
    const [owner = "", key = ""] = target.split(".");
    const byKey = options.get(owner) ?? new Map<string, string[]>();
    byKey.set(key, [...(byKey.get(key) ?? []), value]);
    options.set(owner, byKey);
  }
  const rules: JsonObject = {};
  for (const name of Object.keys(plugin.rules)) {
    const own = options.get(name);
    rules[`${PLUGIN}/${name}`] = own === undefined ? "warn" : ["warn", Object.fromEntries(own)];
  }
  const scan = options.get("scan");
  return { rules, settings: { [PLUGIN]: scan === undefined ? {} : Object.fromEntries(scan) } };
}

/** The rules' hits over a tree under a config fragment, through the Oxlint CLI. */
function linted(root: string, binary: string, fragment: JsonObject): Hit[] {
  const directory = mkdtempSync(join(tmpdir(), "implicit-statescript-survey-"));
  try {
    const config = { categories: { correctness: "off" }, plugins: [], jsPlugins: [{ name: PLUGIN, specifier: PLUGIN_ENTRY }], rules: fragment.rules ?? {} };
    writeFileSync(join(directory, "oxlintrc.json"), JSON.stringify(config));
    const ignored = SKIPPED_NAMES.flatMap((name) => ["--ignore-pattern", `**/${name}/**`]);
    const child = Bun.spawnSync([process.execPath, binary, "-c", join(directory, "oxlintrc.json"), "--format=json", ...ignored, "."], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (child.exitCode !== 0 && child.exitCode !== 1) {
      throw new Error(`oxlint ended with ${String(child.exitCode)}: ${child.stderr.toString()}`);
    }
    // A file Oxlint cannot parse is reported with no code; only this plugin's hits are kept.
    const { diagnostics } = JSON.parse(child.stdout.toString()) as { diagnostics: { code?: string; filename: string; message: string; labels: { span: { line: number } }[] }[] };
    // Oxlint lints files in parallel, so its order is put in path and line order here.
    return diagnostics
      .flatMap((one) => {
        const rule = new RegExp(`^${PLUGIN}\\((.+)\\)$`, "u").exec(one.code ?? "")?.[1];
        return rule === undefined ? [] : [{ rule, path: one.filename, line: one.labels[0]?.span.line ?? 0, message: one.message }];
      })
      .toSorted((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The scan's state findings under the settings of a config fragment. */
function scanned(files: ReadonlyMap<string, string>, fragment: JsonObject): Hit[] {
  const settings = (fragment.settings as JsonObject | undefined)?.[PLUGIN] as ScanOptions | undefined;
  return scatteredLiterals(files, settings ?? {})
    .filter((row) => row.kind === "no-scattered-state-literals")
    .map((row) => ({ rule: row.kind, path: row.path, line: row.line, message: row.detail, places: row.places.map((place) => place.path) }));
}

/** The words of the folder a `no-marker-file-state` message names. */
const folderWords = (message: string): string[] => [.../in `([^`]*)`/u.exec(message)?.[1]?.match(/[$\w]+/gu) ?? []];

const secondsBetween = (from: number, to: number): number => Math.round(to - from) / 1000;

const keyOf = (hit: Hit): string => `${hit.rule} ${hit.path}:${String(hit.line)}`;

/** The hits only in `after`, and those only in `before`, by rule and place. */
function changed(before: readonly Hit[], after: readonly Hit[]): { added: Hit[]; removed: Hit[] } {
  const was = new Set(before.map(keyOf));
  const is = new Set(after.map(keyOf));
  return { added: after.filter((hit) => !was.has(keyOf(hit))), removed: before.filter((hit) => !is.has(keyOf(hit))) };
}

/** Whether a changed hit can be put down to one proposal, read from the hit and its file. */
function explains(proposal: Proposal, hit: Hit, added: boolean, text: (path: string) => string): boolean {
  const { value } = proposal;
  const calls = (): boolean => text(hit.path).includes(`${value}(`);
  const reasons: Record<Target, () => boolean> = {
    "prefer-state-union.ignore": () => !added && hit.rule === "prefer-state-union" && nameMatcher([value])(/^`([^`]+)`/u.exec(hit.message)?.[1] ?? ""),
    "no-coupled-flags.setters": () => added && hit.rule === "no-coupled-flags" && hit.message.includes(`of \`${value}\``),
    "no-marker-file-state.fsWrappers": () => added && hit.rule === "no-marker-file-state" && calls(),
    "no-marker-file-state.stateDirs": () => added && hit.rule === "no-marker-file-state" && folderWords(hit.message).includes(value),
    "no-age-based-lock.fsWrappers": () => added && hit.rule === "no-age-based-lock" && calls(),
    "no-age-based-lock.processReaders": () => !added && hit.rule === "no-age-based-lock" && calls(),
    "scan.stateTypes": () => added && hit.message.startsWith(`\`${value}\` (`),
    "scan.owners": () => (added ? hit.message.startsWith(`\`${value}\` already`) : (hit.places ?? []).includes(proposal.evidence[0]?.path ?? "")),
  };
  return reasons[proposal.target]();
}

/** Survey a tree: propose its facts, and show which hits each would add or remove. */
export function surveyed(root: string, files: ReadonlyMap<string, string>, read: (path: string) => string): SurveyReport {
  const started = performance.now();
  const { proposals, noted } = survey(files);
  const found = performance.now();
  const everything = adopted(proposals);
  const binary = oxlintBinary(root);
  const defaults = adopted([]);
  const lint = { before: linted(root, binary, defaults), after: linted(root, binary, everything) };
  const linting = performance.now();
  const scan = { before: scanned(files, defaults), after: scanned(files, everything) };
  const scanning = performance.now();
  const lintChange = changed(lint.before, lint.after);
  const scanChange = changed(scan.before, scan.after);
  const added = [...lintChange.added, ...scanChange.added];
  const removed = [...lintChange.removed, ...scanChange.removed];
  const texts = new Map<string, string>();
  const text = (path: string): string => {
    const known = texts.get(path) ?? files.get(path) ?? read(path);
    texts.set(path, known);
    return known;
  };
  const rows = proposals.map((proposal) => ({
    ...proposal,
    added: added.filter((hit) => explains(proposal, hit, true, text)),
    removed: removed.filter((hit) => explains(proposal, hit, false, text)),
  }));
  const counted = new Set(rows.flatMap((row) => [...row.added, ...row.removed]));
  return {
    files: files.size,
    before: lint.before.length + scan.before.length,
    after: lint.after.length + scan.after.length,
    proposals: rows,
    noted,
    unexplained: { added: added.filter((hit) => !counted.has(hit)), removed: removed.filter((hit) => !counted.has(hit)) },
    config: adopted(rows.filter((row) => row.added.length + row.removed.length > 0)),
    seconds: { survey: secondsBetween(started, found), lint: secondsBetween(found, linting), scan: secondsBetween(linting, scanning) },
  };
}

/** Sample hits, at most `most` of them, one line each. */
const sample = (hits: readonly Hit[], most = 3): string[] =>
  hits.slice(0, most).map((hit) => `        ${hit.rule} ${hit.path}:${String(hit.line)}  ${hit.message.length > 110 ? `${hit.message.slice(0, 107)}...` : hit.message}`);

/** The report as text: the proposals that change hits, by target, then the rest in brief. */
export function printedSurvey(report: SurveyReport, root: string): string {
  const live = report.proposals.filter((row) => row.added.length + row.removed.length > 0);
  const idle = report.proposals.filter((row) => row.added.length + row.removed.length === 0);
  const { seconds } = report;
  const lines = [
    `${String(report.files)} files surveyed under ${root} (facts ${String(seconds.survey)} s, lint ${String(seconds.lint)} s, scan ${String(seconds.scan)} s)`,
    `hits at the defaults: ${String(report.before)}; with every proposal adopted: ${String(report.after)}`,
  ];
  for (const [target, rows] of Map.groupBy(live, (row) => row.target)) {
    lines.push("", target);
    for (const row of rows) {
      lines.push(`  ${row.value}: ${row.why}`, ...row.evidence.map((one) => `      ${one.path}:${String(one.line)}  ${one.text}`));
      if (row.added.length > 0) {
        lines.push(`    adds ${String(row.added.length)}:`, ...sample(row.added));
      }
      if (row.removed.length > 0) {
        lines.push(`    removes ${String(row.removed.length)}:`, ...sample(row.removed));
      }
    }
  }
  if (idle.length > 0) {
    lines.push("", `${String(idle.length)} more proposals change no hit today:`);
    lines.push(...[...Map.groupBy(idle, (row) => row.target)].map(([target, rows]) => `  ${target}: ${rows.map((row) => row.value).join(", ")}`));
  }
  const unexplained = [...report.unexplained.added, ...report.unexplained.removed];
  if (unexplained.length > 0) {
    lines.push("", `${String(unexplained.length)} changed hits no one proposal explains:`, ...sample(unexplained, 5));
  }
  if (report.noted.length > 0) {
    lines.push("", "noted, read by no option:", ...report.noted.slice(0, 10).map((one) => `  ${one.what}  ${one.evidence[0]?.path ?? ""}:${String(one.evidence[0]?.line ?? 0)}`));
  }
  lines.push("", "config adopting every proposal that changes a hit:", JSON.stringify(report.config, undefined, 2));
  return `${lines.join("\n")}\n`;
}
