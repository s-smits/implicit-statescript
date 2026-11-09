/**
 * The scan over small foreign programs: one owner of a job's states, readers that group them by
 * hand, and beside them the nearest hostile cases (an exhaustive switch, one reader, an unexported
 * set, a reader in a test, a set no update writes).
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { literalSpread } from "./literal-spread.ts";

const OWNER = `export type JobState = "queued" | "running" | "done" | "failed";\n`;
const GROUPS = `import type { JobState } from "./job.ts";
export const ended = (state: JobState): boolean => state === "done" || state === "failed";
`;
const LISTED = `import type { JobState } from "./job.ts";
export const settled = (state: JobState): boolean => ["done", "failed"].includes(state);
`;
const WHOLE = `import type { JobState } from "./job.ts";
export const known = (state: JobState): boolean =>
  state === "queued" || state === "running" || state === "done" || state === "failed";
`;
/** A write the compiler types as `JobState` under another name than the readers compare. */
const RUNS = `import type { JobState } from "./job.ts";
export function finish(job: { phase: JobState }): void {
  job.phase = "done";
}
`;
/** A write of one of the literals into a place that is neither typed by the set nor so named. */
const LABELS = `export function tag(entry: { label: string }): void {
  entry.label = "done";
}
`;
const COVERS = `import type { JobState } from "./job.ts";
export function label(state: JobState): string {
  switch (state) {
    case "queued":
    case "running":
      return "open";
    case "done":
    case "failed":
      return "closed";
  }
}
`;
/** The same owner as a discriminated union, read through its `status` property. */
const TAGGED = `export type Job =
  | { status: "queued" }
  | { status: "running"; pid: number }
  | { status: "done"; code: number }
  | { status: "failed"; error: string };
`;
const TAGGED_READER = `import type { Job } from "./job.ts";
export const over = (job: Job): boolean => job.status === "done" || job.status === "failed";
`;
const TAGGED_WRITER = `import type { Job } from "./job.ts";
export function fail(job: Job): Job {
  return { ...job, status: "failed", error: "killed" } as Job;
}
`;

const findings = (kind: string, files: Record<string, string>): string[] =>
  literalSpread(new Map(Object.entries(files)))
    .filter((row) => row.kind === kind)
    .map((row) => `${row.path}:${String(row.line)} ${row.places.map((place) => `${place.path}:${String(place.line)}`).join(" ")}`);

describe("state-literal-spread", () => {
  const jobs = { "src/job.ts": OWNER, "src/a.ts": GROUPS, "src/b.ts": LISTED };

  it("is reported at the owner of states two other files group by hand and one writes", () => {
    expect(findings("state-literal-spread", { ...jobs, "src/run.ts": RUNS })).toEqual(["src/job.ts:1 src/job.ts:1 src/a.ts:2 src/b.ts:2"]);
  });

  it("counts a chain that spells the whole set, which a switch over it does not", () => {
    const whole = { "src/job.ts": OWNER, "src/a.ts": WHOLE, "src/b.ts": WHOLE, "src/run.ts": RUNS };
    expect(findings("state-literal-spread", whole)).toEqual(["src/job.ts:1 src/job.ts:1 src/a.ts:3 src/b.ts:3"]);
  });

  it("reads a set no update writes, or one written into another place, as an enumeration", () => {
    const enumeration = ["src/job.ts:1 src/job.ts:1 src/a.ts:2 src/b.ts:2"];
    expect(findings("state-literal-spread", jobs)).toEqual([]);
    expect(findings("enumeration-literal-spread", jobs)).toEqual(enumeration);
    expect(findings("enumeration-literal-spread", { ...jobs, "src/tag.ts": LABELS })).toEqual(enumeration);
  });

  it("is not reported for one reader, an exhaustive switch, an unexported set or a test", () => {
    const local = OWNER.replace("export ", "");
    expect(findings("state-literal-spread", { "src/job.ts": OWNER, "src/a.ts": GROUPS, "src/c.ts": COVERS, "src/run.ts": RUNS })).toEqual([]);
    expect(findings("state-literal-spread", { "src/job.ts": local, "src/a.ts": GROUPS, "src/b.ts": LISTED })).toEqual([]);
    expect(findings("state-literal-spread", { "src/job.ts": OWNER, "src/a.ts": GROUPS, "test/b.test.ts": LISTED })).toEqual([]);
  });

  it("reads the discriminant of a union of object types through the property it sits in", () => {
    const files = {
      "src/job.ts": TAGGED,
      "src/a.ts": TAGGED_READER,
      "src/b.ts": TAGGED_READER.replace("over", "stopped"),
      "src/fail.ts": TAGGED_WRITER,
    };
    expect(findings("state-literal-spread", files)).toEqual(["src/job.ts:1 src/job.ts:1 src/a.ts:2 src/b.ts:2"]);
  });

  it("asks for more readers when --readers is raised", () => {
    expect(literalSpread(new Map(Object.entries({ ...jobs, "src/run.ts": RUNS })), 3)).toEqual([]);
  });
});

describe("implicit-statescript scan", () => {
  const cli = resolve(import.meta.dirname, "cli.ts");
  const root = mkdtempSync(join(tmpdir(), "implicit-statescript-scan-"));
  const files = { "src/job.ts": OWNER, "src/a.ts": GROUPS, "src/b.ts": LISTED, "src/run.ts": RUNS, "node_modules/x/a.ts": GROUPS };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });

  it("prints one JSON row a finding, skipping node_modules", () => {
    const child = run("scan", root, "--json");
    expect(child.exitCode).toBe(0);
    const rows = JSON.parse(child.stdout.toString()) as { rule: string; file: string; line: number }[];
    expect(rows.map(({ rule, file, line }) => `${rule} ${file}:${String(line)}`)).toEqual(["state-literal-spread src/job.ts:1"]);
  });

  it("exits 1 on a state finding under --error, and 2 on a bad command", () => {
    expect(run("scan", root, "--error").exitCode).toBe(1);
    expect(run("lint", root).exitCode).toBe(2);
  });
});
