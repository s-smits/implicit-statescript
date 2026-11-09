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

/** The rules a config enables, by id, and the configs it extends. */
function tier(name: string): { rules: string[]; extends: string[] } {
  const config = JSON.parse(readFileSync(resolve(ROOT, `src/configs/${name}.json`), "utf8")) as {
    rules: Record<string, unknown>;
    extends?: string[];
  };
  const rules = Object.keys(config.rules).map((id) => id.replace(/^implicit-state\//u, ""));
  return { rules, extends: config.extends ?? [] };
}

it("places every rule in one tier: the recommended config, or the opinionated one that extends it", () => {
  const recommended = tier("recommended");
  const opinionated = tier("opinionated");
  expect(opinionated.extends).toEqual(["./recommended.json"]);
  expect(recommended.rules.filter((id) => opinionated.rules.includes(id))).toEqual([]);
  expect([...recommended.rules, ...opinionated.rules].toSorted()).toEqual(Object.keys(plugin.rules).toSorted());
});

it("reports on the examples what the README says each config reports", () => {
  const counts = (config: string): number => {
    const child = Bun.spawnSync(
      [process.execPath, resolve(ROOT, "node_modules/oxlint/bin/oxlint"), "-c", config, "--format=json", "examples"],
      { cwd: ROOT },
    );
    const report = JSON.parse(child.stdout.toString()) as { diagnostics: { code: string }[] };
    return report.diagnostics.filter((one) => one.code.startsWith("implicit-state(")).length;
  };
  expect(counts("src/configs/recommended.json")).toBe(4);
  expect(counts("src/configs/opinionated.json")).toBe(7);
  expect(counts("examples/tailored.oxlintrc.json")).toBe(6);
});
