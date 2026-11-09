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
`;

tester.run("implicit-state/no-age-based-lock", noAgeBasedLockRule, {
  valid: [
    {
      name: "a file time against another timestamp asks newer-than, a cache question",
      code: `import { statSync } from "node:fs";
export function newer(file: string, lastRun: number): boolean {
  return statSync(file).mtimeMs > lastRun;
}`,
    },
    {
      name: "an elapsed time that reads no file",
      code: `export function expired(started: number, limit: number): boolean {
  return Date.now() - started > limit;
}`,
    },
    {
      name: "a window the caller passes is a question the caller asks",
      code: `import { statSync } from "node:fs";
export function old(file: string, days: number): boolean {
  return Date.now() - statSync(file).mtimeMs > days * 86_400_000;
}`,
    },
    {
      name: "an age printed rather than compared",
      code: `import { statSync } from "node:fs";
export const ageOf = (file: string): number => Date.now() - statSync(file).mtimeMs;`,
    },
    {
      name: "a file time read through another module's function is unknown by default",
      code: `import { mtimeOf } from "./fs.ts";
const STALE_MS = 60_000;
export const stale = (lock: string) => Date.now() - mtimeOf(lock) > STALE_MS;`,
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
      name: "a test file is not read",
      filename: "src/locks.test.ts",
      code: `import { statSync } from "node:fs";
const STALE_MS = 60_000;
export const stale = (lock: string) => Date.now() - statSync(lock).mtimeMs > STALE_MS;`,
    },
  ],
  invalid: [
    {
      name: "the whole fixture reports the age and its mirror, and nothing else",
      filename: "src/locks.ts",
      code: LOCKS,
      errors: [
        { ...age, line: 4 },
        { ...age, line: 5 },
      ],
    },
    {
      name: "Bun's lastModified against a constant whatever its name",
      code: `const limit = 30 * 1000;
export async function stale(lock: string): Promise<boolean> {
  return Date.now() - Bun.file(lock).lastModified > limit;
}`,
      errors: [{ ...age, line: 3 }],
    },
    {
      name: "a Date read of mtime through getTime",
      code: `import { statSync } from "node:fs";
export const stale = (lock: string) => Date.now() - statSync(lock).mtime.getTime() >= 5_000;`,
      errors: [{ ...age, line: 2 }],
    },
    {
      name: "fsWrappers names a function that returns a file's time",
      code: `import { mtimeOf } from "./fs.ts";
const STALE_MS = 60_000;
export const stale = (lock: string) => Date.now() - mtimeOf(lock) > STALE_MS;`,
      options: [{ fsWrappers: ["mtimeOf"] }],
      errors: [{ ...age, line: 3 }],
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
  ],
});
