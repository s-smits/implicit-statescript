import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import plugin from "../src/index.ts";

it("registers under the name its rules are configured by", () => {
  expect(plugin.meta?.name).toBe("implicit-state");
});

it("keeps a suite, a description and an example pair beside every rule", () => {
  for (const [id, rule] of Object.entries(plugin.rules)) {
    expect(existsSync(resolve(import.meta.dirname, `../src/rules/${id}.test.ts`)), id).toBe(true);
    expect(rule.meta?.docs?.description, id).toBeString();
    expect(rule.meta?.docs?.examples, id).not.toBeEmpty();
  }
});
