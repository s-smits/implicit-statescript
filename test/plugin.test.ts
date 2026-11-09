import { expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import plugin from "../src/index.ts";
import { FINDING_KINDS } from "../src/scan/scattered-literals.ts";

/** ESLint's convention: the prefix decides a rule's kind, and the rest names its subject. */
const RULE_NAME = /^(?<kind>no|prefer|require|max)-(?<subject>[a-z]+(?:-[a-z]+)*)$/u;
const ROOT = resolve(import.meta.dirname, "..");

it("registers under the name its rules are configured by", () => {
  expect(plugin.meta?.name).toBe("implicit-state");
});

it("keeps a suite, a description and an example pair beside every rule", () => {
  for (const [id, rule] of Object.entries(plugin.rules)) {
    expect(existsSync(resolve(ROOT, `src/rules/${id}.test.ts`)), id).toBe(true);
    expect(rule.meta?.docs?.description, id).toBeString();
    expect(rule.meta?.docs?.examples, id).not.toBeEmpty();
  }
});

it("names every rule and scan kind by one pattern that decides its kind", () => {
  for (const id of [...Object.keys(plugin.rules), ...FINDING_KINDS]) {
    expect(RULE_NAME.exec(id)?.groups?.kind, id).toBeString();
  }
});

it("registers every rule file under its own name", () => {
  const files = readdirSync(resolve(ROOT, "src/rules")).filter((name) => !name.endsWith(".test.ts"));
  expect(files.map((name) => name.replace(/\.ts$/u, "")).toSorted()).toEqual(Object.keys(plugin.rules).toSorted());
});

it("names in the README and the skills only rules and scan kinds that exist", () => {
  const known = new Set([...Object.keys(plugin.rules), ...FINDING_KINDS]);
  const skills = readdirSync(resolve(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`);
  for (const path of ["README.md", ...skills]) {
    const text = readFileSync(resolve(ROOT, path), "utf8");
    const named = [...text.matchAll(/`(?:implicit-state\/)?((?:no|prefer|require|max)-[a-z]+(?:-[a-z]+)*)`/gu)];
    const ids = new Set(named.map((match) => match[1] ?? ""));
    expect([...ids].filter((id) => !known.has(id)), path).toEqual([]);
  }
});
