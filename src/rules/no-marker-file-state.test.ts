import { RuleTester } from "../../test/rule-tester.ts";

import { noMarkerFileStateRule } from "./no-marker-file-state.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const phase = { messageId: "phase" };
const marker = { messageId: "marker" };

/** A phase read through an existence check another module wraps, invisible from this file. */
const IMPORTED = `import { join } from "node:path";
import { isFile } from "./fs.ts";
export function phaseOf(runDir: string): string {
  if (isFile(join(runDir, "done.json"))) return "done";
  return isFile(join(runDir, "started.json")) ? "running" : "queued";
}`;

/** One marker in a run's folder deciding the phase. */
const ONE_MARKER = `import { existsSync } from "node:fs";
import { join } from "node:path";
export function finished(runDir: string): boolean {
  return existsSync(join(runDir, "done.json"));
}`;

const PHASES = `import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export function phaseOf(jobDir: string): string {
  if (existsSync(join(jobDir, "done.json"))) return "done";
  return existsSync(join(jobDir, "started.json")) ? "running" : "queued"; // REPORT two files of one folder decide the phase
}
const present = (path: string): boolean => existsSync(path);
export function wrapped(jobDir: string): boolean {
  if (present(\`\${jobDir}/lock\`)) return true;
  return present(\`\${jobDir}/report.json\`); // REPORT through a wrapper that reduces to existsSync
}
export function ensure(jobDir: string): void {
  if (!existsSync(jobDir)) mkdirSync(jobDir); // ADMITTED a single guard
}
export function apart(jobDir: string, cacheDir: string): boolean {
  return existsSync(join(jobDir, "done.json")) && existsSync(join(cacheDir, "hit.json")); // ADMITTED two folders
}
`;

tester.run("implicit-state/no-marker-file-state", noMarkerFileStateRule, {
  valid: [
    {
      name: "a single guard",
      code: `import { existsSync, mkdirSync } from "node:fs";
export function ensure(jobDir: string): void {
  if (!existsSync(jobDir)) mkdirSync(jobDir);
}`,
    },
    {
      name: "files in two different folders",
      code: `import { existsSync } from "node:fs";
import { join } from "node:path";
export function apart(jobDir: string, cacheDir: string): boolean {
  return existsSync(join(jobDir, "done.json")) && existsSync(join(cacheDir, "hit.json"));
}`,
    },
    {
      name: "one file checked twice",
      code: `import { existsSync } from "node:fs";
import { join } from "node:path";
export function twice(dir: string): boolean {
  if (existsSync(join(dir, "lock"))) return true;
  return existsSync(join(dir, "lock"));
}`,
    },
    {
      name: "a check that guards its own use reads an optional file",
      code: `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function config(dir: string): string {
  const a = existsSync(join(dir, "a.json")) ? readFileSync(join(dir, "a.json"), "utf8") : "";
  const b = existsSync(join(dir, "b.json")) ? readFileSync(join(dir, "b.json"), "utf8") : "";
  return a + b;
}`,
    },
    {
      name: "a test file is not read",
      filename: "test/phases.ts",
      code: PHASES,
    },
    { name: "an imported existence check is unknown by default", code: IMPORTED },
    { name: "one marker is a guard by default", code: ONE_MARKER },
    {
      name: "stateDirs leaves a folder it does not name to the two-file reading",
      code: ONE_MARKER,
      options: [{ stateDirs: ["stateDir"] }],
    },
    {
      name: "a marker in a state folder that guards its own use reads an optional file",
      code: `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const notes = (runDir: string): string =>
  existsSync(join(runDir, "notes.txt")) ? readFileSync(join(runDir, "notes.txt"), "utf8") : "";`,
      options: [{ stateDirs: ["runDir"] }],
    },
    { name: "files: 3 asks for a third file", filename: "src/phases.ts", code: PHASES, options: [{ files: 3 }] },
  ],
  invalid: [
    {
      name: "the whole fixture reports the phase and the wrapped phase, and nothing else",
      filename: "src/phases.ts",
      code: PHASES,
      errors: [
        { ...phase, line: 5 },
        { ...phase, line: 10 },
      ],
    },
    {
      name: "Bun.file(p).exists() over a paths object",
      code: `export async function phase(paths: { lock: string; done: string }): Promise<string> {
  if (await Bun.file(paths.done).exists()) return "done";
  return (await Bun.file(paths.lock).exists()) ? "running" : "idle";
}`,
      errors: [{ ...phase, line: 3 }],
    },
    {
      name: "fs-extra's pathExistsSync under a namespace, with the answers held in consts",
      code: `import fs from "fs-extra";
export function phase(dir: string): string {
  const started = fs.pathExistsSync(dir + "/started");
  const finished = fs.pathExistsSync(dir + "/finished");
  return finished ? "done" : started ? "running" : "queued";
}`,
      errors: [{ ...phase, line: 4 }],
    },
    {
      name: "fsWrappers names an existence check from another module",
      code: IMPORTED,
      options: [{ fsWrappers: ["isFile"] }],
      errors: [{ ...phase, line: 5 }],
    },
    {
      name: "a named wrapper taking a folder and a file reads them as the place",
      code: `import { hasMarker } from "./markers.ts";
export function phaseOf(runDir: string): string {
  if (hasMarker(runDir, "done")) return "done";
  return hasMarker(runDir, "started") ? "running" : "queued";
}`,
      options: [{ fsWrappers: ["has*"] }],
      errors: [{ ...phase, line: 4 }],
    },
    {
      name: "stateDirs makes one deciding marker in a state folder a phase",
      code: ONE_MARKER,
      options: [{ stateDirs: ["runDir"] }],
      errors: [{ ...marker, line: 4 }],
    },
  ],
});
