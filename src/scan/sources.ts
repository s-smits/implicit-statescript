/**
 * The TypeScript files a whole-tree command reads under a folder. Folders named `node_modules`,
 * `dist`, `build`, `out`, `coverage`, `vendor`, `vendored`, `third_party` or `generated`, and every
 * dot folder, are skipped, as are declaration files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Folder names no whole-tree command reads, beside every dot folder. */
export const SKIPPED_NAMES = ["node_modules", "dist", "build", "out", "coverage", "vendor", "vendored", "third_party", "third-party", "generated"];
const SKIPPED = new Set(SKIPPED_NAMES);
const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;

/** Every TypeScript file under a folder, by its path relative to the folder, with its text. */
export function sourcesUnder(root: string, at = root, files = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory() && !SKIPPED.has(entry.name) && !entry.name.startsWith(".")) {
      sourcesUnder(root, path, files);
    } else if (entry.isFile() && SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      files.set(relative(root, path), readFileSync(path, "utf8"));
    }
  }
  return files;
}
