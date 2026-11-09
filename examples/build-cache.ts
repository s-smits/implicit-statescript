// A build cache whose phase is read from marker files and whose lock is judged by its age.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_STALE_MS = 10 * 60 * 1000;

// files-as-phase: which markers exist in one folder decides the phase.
export function cachePhase(dir: string): "ready" | "building" | "empty" {
  if (existsSync(join(dir, "manifest.json"))) return "ready";
  if (existsSync(join(dir, "build.lock"))) return "building";
  return "empty";
}

// mtime-as-lock: an old lock is taken to mean its holder died.
export function takeLock(dir: string): void {
  const lock = join(dir, "build.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
    rmSync(lock);
  }
  writeFileSync(lock, String(process.pid), { flag: "wx" });
}

// Passes: one guard, and an optional file read only where it exists.
export function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const notes = join(dir, "notes.txt");
  return existsSync(notes) ? readFileSync(notes, "utf8") : "";
}

// Passes: newer-than is a cache question, not a guess at a holder.
export function stale(dir: string, source: string): boolean {
  return statSync(source).mtimeMs > statSync(join(dir, "manifest.json")).mtimeMs;
}
