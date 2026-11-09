/**
 * The survey over one small tree that holds each fact it proposes once, beside the nearest case it
 * must not propose: a record whose flags are written, a wrapper nobody else calls, a call whose
 * result is used. The command runs once, end to end, to show what adopting each fact changes.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { survey } from "./survey.ts";
import type { SurveyReport } from "./survey-hits.ts";

const TREE: Record<string, string> = {
  "src/fs.ts": `import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
export function isThere(path: string): boolean {
  return existsSync(path);
}
export function mtimeOf(path: string): number {
  return statSync(path).mtimeMs;
}
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export function headOf(dir: string): string {
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir }).stdout.toString();
}
`,
  "src/run.ts": `import { join } from "node:path";
import { isThere } from "./fs.ts";
export function phaseOf(runDir: string): string {
  if (isThere(join(runDir, "done"))) return "done";
  return isThere(join(runDir, "started")) ? "running" : "idle";
}
`,
  "src/lock.ts": `import { readFileSync, rmSync, statSync } from "node:fs";
import { isAlive, mtimeOf } from "./fs.ts";
const STALE_MS = 60_000;
export const stale = (lock: string): boolean => Date.now() - mtimeOf(lock) > STALE_MS;
export function clear(lock: string): void {
  const holder = Number(readFileSync(lock, "utf8"));
  if (!isAlive(holder) && Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock);
}
`,
  "src/tools.ts": `export function tools(editor: { updateInstanceState(next: object): void; pick(at: object): number }) {
  editor.updateInstanceState({ isToolLocked: true, isPenMode: false });
  editor.updateInstanceState({ isToolLocked: false, isPenMode: true });
  editor.updateInstanceState({ isToolLocked: false, isPenMode: false });
  return [editor.pick({ exact: true, hidden: false }), editor.pick({ exact: false, hidden: true }), editor.pick({ exact: false, hidden: false })];
}
`,
  "src/options.ts": `export interface BuildOptions {
  minify: boolean;
  sourcemap: boolean;
  watch: boolean;
  clean: boolean;
}
export interface Job {
  queued: boolean;
  running: boolean;
  done: boolean;
  failed: boolean;
}
export function finishJob(job: Job): void {
  job.done = true;
}
`,
  "src/state.ts": `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function save(runDir: string, phase: string): void {
  writeFileSync(join(runDir, "state.json"), JSON.stringify({ phase }));
}
export function load(runDir: string): { phase: string } {
  return JSON.parse(readFileSync(join(runDir, "state.json"), "utf8")) as { phase: string };
}
export function finished(runDir: string): string {
  return existsSync(join(runDir, "done")) ? "done" : "running";
}
`,
  "src/job.ts": `export type JobState = "queued" | "running" | "done" | "failed";
export const isOpen = (job: { state: JobState }): boolean => job.state === "queued" || job.state === "running";
`,
  "src/label.ts": `import type { JobState } from "./job.ts";
export function label(job: { state: JobState }): string {
  if (job.state === "done" || job.state === "failed") return "closed";
  return "open";
}
`,
  "src/finish.ts": `import type { JobState } from "./job.ts";
export function finish(job: { state: JobState }): void {
  job.state = "done";
}
`,
};

describe("survey", () => {
  const { proposals, noted } = survey(new Map(Object.entries(TREE)));

  it("proposes each fact the tree holds, and none of the nearest cases beside them", () => {
    expect(proposals.map((one) => `${one.target} ${one.value}`)).toEqual([
      "prefer-state-union.ignore BuildOptions",
      "no-coupled-flags.setters updateInstanceState",
      "no-marker-file-state.fsWrappers isThere",
      "no-marker-file-state.stateDirs runDir",
      "no-age-based-lock.fsWrappers mtimeOf",
      "no-age-based-lock.processReaders isAlive",
      "scan.stateTypes JobState",
      "scan.owners isOpen",
    ]);
  });

  it("gives each proposal the place it rests on", () => {
    const first = (target: string): string => {
      const at = proposals.find((one) => one.target === target)?.evidence[0];
      return `${at?.path ?? ""}:${String(at?.line ?? 0)}`;
    };
    expect(first("no-marker-file-state.fsWrappers")).toBe("src/fs.ts:3");
    expect(first("prefer-state-union.ignore")).toBe("src/options.ts:1");
    expect(first("scan.stateTypes")).toBe("src/job.ts:1");
  });

  it("notes a wrapper of git, which no option reads", () => {
    expect(noted.map((one) => one.what)).toEqual(["`headOf` wraps git"]);
  });
});

describe("implicit-statescript survey", () => {
  const root = mkdtempSync(join(tmpdir(), "implicit-statescript-survey-"));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const child = Bun.spawnSync([process.execPath, resolve(import.meta.dirname, "cli.ts"), "survey", root, "--json"], { stdout: "pipe", stderr: "pipe" });

  it("prints, as JSON, the hits adopting each fact adds and removes", () => {
    expect(child.exitCode).toBe(0);
    const report = JSON.parse(child.stdout.toString()) as SurveyReport;
    const effect = report.proposals.map((one) =>
      [`${one.target} ${one.value}`, ...one.added.map((hit) => `+${hit.rule} ${hit.path}:${String(hit.line)}`), ...one.removed.map((hit) => `-${hit.rule} ${hit.path}:${String(hit.line)}`)].join(" "),
    );
    expect(effect).toEqual([
      "prefer-state-union.ignore BuildOptions -prefer-state-union src/options.ts:1",
      "no-coupled-flags.setters updateInstanceState +no-coupled-flags src/tools.ts:2",
      "no-marker-file-state.fsWrappers isThere +no-marker-file-state src/run.ts:5",
      "no-marker-file-state.stateDirs runDir +no-marker-file-state src/run.ts:5 +no-marker-file-state src/state.ts:10",
      "no-age-based-lock.fsWrappers mtimeOf +no-age-based-lock src/lock.ts:4",
      "no-age-based-lock.processReaders isAlive -no-age-based-lock src/lock.ts:7",
      "scan.stateTypes JobState +no-scattered-state-literals src/job.ts:1",
      "scan.owners isOpen",
    ]);
    expect(report.unexplained).toEqual({ added: [], removed: [] });
  });
});
