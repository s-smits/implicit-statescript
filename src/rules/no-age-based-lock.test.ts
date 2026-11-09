import { RuleTester } from "../../test/rule-tester.ts";

import { noAgeBasedLockRule } from "./no-age-based-lock.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const age = { messageId: "age" };

const LOCKS = `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function clearStale(lock: string): void {
  if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock);
  if (statSync(lock).mtimeMs < Date.now() - STALE_MS) rmSync(lock);
}
export function newer(file: string, lastRun: number): boolean {
  return statSync(file).mtimeMs > lastRun;
}
export function expired(started: number, limit: number): boolean {
  return Date.now() - started > limit;
}
export function old(file: string, days: number): boolean {
  return Date.now() - statSync(file).mtimeMs > days * 86_400_000;
}
export function recent(files: readonly string[]): string[] {
  return files.filter((file) => Date.now() - statSync(file).mtimeMs < STALE_MS);
}
export function lapsed(lock: string): boolean {
  return Date.now() - statSync(lock).mtimeMs > STALE_MS;
}
export function takeOver(lock: string, holder: number): void {
  const release = (): void => rmSync(lock);
  try {
    if (statSync(lock).mtimeMs < Date.now() - STALE_MS) throw new Error("stale");
  } catch {
    release();
  }
  if (Date.now() - statSync(lock).mtimeMs > STALE_MS) process.kill(holder);
}
`;

tester.run("implicit-state/no-age-based-lock", noAgeBasedLockRule, {
  valid: [
    {
      name: "a file time against another timestamp asks newer-than, a cache question",
      code: `import { rmSync, statSync } from "node:fs";
export function refresh(file: string, lastRun: number): void {
  if (statSync(file).mtimeMs > lastRun) rmSync(file);
}`,
    },
    {
      name: "an elapsed time that reads no file",
      code: `export function expired(started: number, limit: number, holder: number): void {
  if (Date.now() - started > limit) process.kill(holder);
}`,
    },
    {
      name: "a window the caller passes is a question the caller asks",
      code: `import { rmSync, statSync } from "node:fs";
export function prune(file: string, days: number): void {
  if (Date.now() - statSync(file).mtimeMs > days * 86_400_000) rmSync(file);
}`,
    },
    {
      name: "an age printed rather than compared",
      code: `import { statSync } from "node:fs";
export const ageOf = (file: string): number => Date.now() - statSync(file).mtimeMs;`,
    },
    {
      name: "a file time read through another module's function is unknown by default",
      code: `import { rmSync } from "node:fs";
import { mtimeOf } from "./fs.ts";
const STALE_MS = 60_000;
export const clear = (lock: string) => Date.now() - mtimeOf(lock) > STALE_MS && rmSync(lock);`,
    },
    {
      name: "an age that only selects what a report shows takes nothing over",
      code: `import { statSync } from "node:fs";
const RECENT_MS = 60_000;
export function recent(files: readonly string[]): string[] {
  return files.filter((file) => Date.now() - statSync(file).mtimeMs < RECENT_MS);
}`,
    },
    {
      name: "an age test in a function that deletes, renames and signals nothing",
      code: `import { statSync } from "node:fs";
const STALE_MS = 60_000;
export function lapsed(lock: string): boolean {
  return Date.now() - statSync(lock).mtimeMs > STALE_MS;
}`,
    },
    {
      name: "a removal in another function does not reach an age that function never calls",
      code: `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export const lapsed = (lock: string) => Date.now() - statSync(lock).mtimeMs > STALE_MS;
export const release = (lock: string) => rmSync(lock);`,
    },
    {
      name: "processReaders: a function that asks whether the holder lives uses the age as a fallback",
      code: `import { rmSync, statSync, readFileSync } from "node:fs";
import { isAlive } from "./process.ts";
const STALE_MS = 60_000;
export function clear(lock: string): void {
  const holder = Number(readFileSync(lock, "utf8"));
  if (!isAlive(holder) && Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock);
}`,
      options: [{ processReaders: ["isAlive"] }],
    },
    {
      name: "a deletion by age that names no holder is retention",
      code: `import { readdirSync, rmSync, statSync } from "node:fs";
const WEEK_MS = 7 * 86_400_000;
export function pruneBuilds(root: string): void {
  for (const dir of readdirSync(root)) {
    if (Date.now() - statSync(dir).mtimeMs > WEEK_MS) rmSync(dir, { recursive: true });
  }
}`,
    },
    {
      name: "a holder word only inside a longer word is no holder",
      code: `import { rmSync, statSync } from "node:fs";
const WEEK_MS = 7 * 86_400_000;
export function prune(blocked: string, departure: string): void {
  if (Date.now() - statSync(blocked).mtimeMs > WEEK_MS) rmSync(departure);
}`,
    },
    {
      name: "holderWords replaces the default list, so a lock it leaves out is no holder",
      code: `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export const clear = (lock: string) => Date.now() - statSync(lock).mtimeMs > STALE_MS && rmSync(lock);`,
      options: [{ holderWords: ["lease"] }],
    },
    {
      name: "a test file is not read",
      filename: "src/locks.test.ts",
      code: `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export const clear = (lock: string) => Date.now() - statSync(lock).mtimeMs > STALE_MS && rmSync(lock);`,
    },
  ],
  invalid: [
    {
      name: "the whole fixture reports each age a removal or a signal follows, and nothing else",
      filename: "src/locks.ts",
      code: LOCKS,
      errors: [
        { ...age, line: 4 },
        { ...age, line: 5 },
        { ...age, line: 25 },
        { ...age, line: 29 },
      ],
    },
    {
      name: "a removal through a function of this file that deletes the lock",
      code: `import { statSync, unlinkSync } from "node:fs";
const STALE_MS = 60_000;
function release(lock: string): void {
  unlinkSync(lock);
}
export function claim(lock: string): void {
  if (Date.now() - statSync(lock).mtimeMs > STALE_MS) release(lock);
}`,
      errors: [{ ...age, line: 7 }],
    },
    {
      name: "a module-level age beside a module-level rename",
      code: `import { renameSync, statSync } from "node:fs";
const STALE_MS = 60_000;
const lock = "run.lock";
if (Date.now() - statSync(lock).mtimeMs > STALE_MS) renameSync(lock, "run.lock.old");`,
      errors: [{ ...age, line: 4 }],
    },
    {
      name: "Bun's lastModified against a constant whatever its name",
      code: `import { rm } from "node:fs/promises";
const limit = 30 * 1000;
export async function clear(lock: string): Promise<void> {
  if (Date.now() - Bun.file(lock).lastModified > limit) await rm(lock);
}`,
      errors: [{ ...age, line: 4 }],
    },
    {
      name: "a Date read of mtime through getTime",
      code: `import { statSync } from "node:fs";
export const clear = (lock: string, holder: number) =>
  Date.now() - statSync(lock).mtime.getTime() >= 5_000 && process.kill(holder);`,
      errors: [{ ...age, line: 3 }],
    },
    {
      name: "fsWrappers names a function that returns a file's time",
      code: `import { rmSync } from "node:fs";
import { mtimeOf } from "./fs.ts";
const STALE_MS = 60_000;
export const clear = (lock: string) => Date.now() - mtimeOf(lock) > STALE_MS && rmSync(lock);`,
      options: [{ fsWrappers: ["mtimeOf"] }],
      errors: [{ ...age, line: 4 }],
    },
    {
      name: "the same age test is reported where no process reader is named",
      code: `import { rmSync, statSync, readFileSync } from "node:fs";
import { isAlive } from "./process.ts";
const STALE_MS = 60_000;
export function clear(lock: string): void {
  const holder = Number(readFileSync(lock, "utf8"));
  if (!isAlive(holder) && Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock);
}`,
      errors: [{ ...age, line: 6 }],
    },
    {
      name: "a holder named only in an enclosing function",
      code: `import { readdirSync, rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function sweepLocks(root: string): void {
  readdirSync(root).forEach((entry) => {
    if (Date.now() - statSync(entry).mtimeMs > STALE_MS) rmSync(entry);
  });
}`,
      errors: [{ ...age, line: 5 }],
    },
    {
      name: "a holder named only in a regular expression",
      code: `import { readdirSync, rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function sweep(root: string): void {
  const written = /\\.tmp\\.\\d+$/u;
  for (const entry of readdirSync(root)) {
    if (written.test(entry) && Date.now() - statSync(entry).mtimeMs > STALE_MS) rmSync(entry);
  }
}`,
      errors: [{ ...age, line: 6 }],
    },
    {
      name: "a holder named only in a template string",
      code: `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function clear(root: string, name: string): void {
  const file = \`\${root}/\${name}.part\`;
  if (Date.now() - statSync(file).mtimeMs > STALE_MS) rmSync(file);
}`,
      errors: [{ ...age, line: 5 }],
    },
    {
      name: "holderWords adds a word the default lacks",
      code: `import { readdirSync, rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function pruneSessions(root: string): void {
  for (const dir of readdirSync(root)) {
    if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir);
  }
}`,
      options: [{ holderWords: ["Session", "sessions"] }],
      errors: [{ ...age, line: 5 }],
    },
  ],
});
