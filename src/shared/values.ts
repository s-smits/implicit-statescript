/**
 * Shape tests for values a rule receives without a known type: its options and the value a literal
 * node holds. Oxlint types both as JSON, so these narrow a JSON value to the primitive a rule needs.
 */

/** A value parsed from JSON, as Oxlint hands a rule its options. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = Record<string, JsonValue>;

/** Whether the value is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether the value is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether the value is a boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** The value as a JSON object, or null for any other value, an array or null among them. */
export function asRecord(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** The strings of a list option, or none where the option is absent or not a list. */
export function stringsOf(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

/**
 * A test of a name against a list option of names, where `*` stands for any run of characters:
 * `["TLInstance", "*Options"]` matches `TLInstance` and `BuildOptions`. An empty list matches
 * nothing, so a rule whose option is left out reads as it does by default.
 */
export function nameMatcher(value: JsonValue | undefined): (name: string) => boolean {
  const patterns = stringsOf(value).map(
    (one) => new RegExp(`^${one.split("*").map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`)).join(".*")}$`, "u"),
  );
  return (name) => patterns.some((pattern) => pattern.test(name));
}

/** The JSON schema of a list option of names. */
export const NAMES_SCHEMA = { type: "array", items: { type: "string" } } as const;

/**
 * One before-and-after pair a rule keeps in `meta.docs.examples`: `before` is the shape it reports
 * and `after` a repair it passes. Each rule's tests lint both.
 */
export interface RuleExample {
  readonly before: string;
  readonly after: string;
}
